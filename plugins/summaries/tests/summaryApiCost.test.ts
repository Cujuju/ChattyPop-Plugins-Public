// Contract: a run stores its calls' API-rate cost only when every call reported one.
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '@shared/settings';
import { MS_PER_MIN } from '@shared/units';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { ARRIVAL } from '@core/arrival';
import type { Db } from '@core/db';
import type { CompletionResult, LlmProvider } from '@core/ai/types';
import { DEFAULT_SUMMARY_SETTINGS } from '../shared/settings';
import { Summarizer } from '../core/summarize';
import { summarySpend } from '../core/summaryRows';
import type { SummaryProviders } from '../core/providers';
import { adoptSummaries } from './summariesHarness';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';

/** Small enough that the three seeded messages take three chunk calls and a merge call. */
const ONE_MESSAGE_CHARS = 40;
const DRAFT = { headline: 'h', items: [{ parts: [{ text: 'p', refs: ['m1'] }] }] };

let db: Db;
beforeEach(() => {
  db = adoptSummaries(tempDb());
  seedArchive(db, [{ id: 'c1' }]).ingestMessages(
    Array.from({ length: 3 }, (_, i) => rawMessage('c1', Date.now() - MS_PER_MIN + i, `message ${i}`)),
    ARRIVAL.gateway,
  );
});

const CODEX = { ...DEFAULT_AI_SETTINGS, defaultProvider: 'codex' as const, providers: { codex: { enabled: true, model: null, effort: null, displayName: null } } };

/** Runs a summary whose calls report these costs in turn (undefined = not reported). */
async function runWithCosts(costs: (number | undefined)[], sinceTs = 0) {
  let call = 0;
  const provider: LlmProvider = {
    id: 'codex',
    maxInputChars: ONE_MESSAGE_CHARS,
    complete: async (): Promise<CompletionResult> => {
      const apiCostUsd = costs[call++];
      return { text: '', json: DRAFT, usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2 }, ...(apiCostUsd !== undefined ? { apiCostUsd } : {}) };
    },
    listModels: async () => [],
  };
  const registry: SummaryProviders = { get: () => provider, decider: () => null, permitted: (ids) => [...ids], localNames: () => [], effective: (s) => s };
  const s = new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => undefined);
  const summary = await s.run({ sinceTs }, CODEX, DEFAULT_SUMMARY_SETTINGS, 'manual');
  return { summary, calls: call, s, settings: CODEX };
}

describe('summary API-rate cost', () => {
  it('sums every call and reads back as stored', async () => {
    const { summary, calls } = await runWithCosts([0.01, 0.02, 0.03, 0.04]);
    expect(calls).toBe(4);
    expect(summary.apiCostUsd).toBeCloseTo(0.1, 10);
    expect(summary.usage).toEqual({ inputTokens: 40, cachedInputTokens: 16, outputTokens: 8 });
  });

  it('is unknown when any call reported no cost, not a partial sum', async () => {
    const { summary } = await runWithCosts([0.01, undefined, 0.03, 0.04]);
    expect(summary.apiCostUsd).toBeNull();
  });

  it('totals runs since a time, leaving runs without a cost out of the dollars and counting them', async () => {
    const before = Date.now();
    await runWithCosts([0.01, 0.02, 0.03, 0.04]);
    await runWithCosts([0.01, undefined, 0.03, 0.04], 1); // another range: not served from cache
    const spend = summarySpend(db, before);
    expect(spend.jevCostUsd).toBe(0);
    expect(spend.providers).toEqual([
      { provider: 'codex', runs: 2, inputTokens: 80, cachedInputTokens: 32, outputTokens: 16, unpricedRuns: 1, apiCostUsd: expect.closeTo(0.1, 10) },
    ]);
    expect(summarySpend(db, Date.now() + 1)).toEqual({ providers: [], jevCostUsd: 0 });
  });

  it("projects the model's cost from what its priced runs cost per message, and nothing for a cached range", async () => {
    const { s, settings } = await runWithCosts([0.01, 0.02, 0.03, 0.04]); // $0.10 for 3 messages
    expect(s.estimate({ sinceTs: 0 }, settings, DEFAULT_SUMMARY_SETTINGS)).toMatchObject({ cached: true, modelUsd: null });
    expect(s.estimate({ sinceTs: 1 }, settings, DEFAULT_SUMMARY_SETTINGS)!.modelUsd).toBeCloseTo(0.1, 10);
  });
});
