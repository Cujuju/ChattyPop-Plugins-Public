// Contract: a comparison sends every model the same log, parts and prompts; only the model and its thinking level differ.
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '@shared/settings';
import { MS_PER_MIN } from '@shared/units';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { ARRIVAL } from '@core/arrival';
import type { Db } from '@core/db';
import type { CompletionRequest, CompletionResult, LlmProvider } from '@core/ai/types';
import type { ProviderId } from '@shared/settings';
import { DEFAULT_SUMMARY_SETTINGS } from '../shared/settings';
import type { CompareModel } from '../shared/compare';
import { Summarizer } from '../core/summarize';
import { Comparer } from '../core/compare';
import { summarySpend } from '../core/summaryRows';
import type { SummaryProviders } from '../core/providers';
import { adoptSummaries } from './summariesHarness';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';

/** Two seeded messages per part at the smallest budget: the log goes in parts, then a merge. */
const SMALL_BUDGET = 40;
/** Large enough for the whole log in one call. */
const LARGE_BUDGET = 100_000;
const DRAFT = { headline: 'h', items: [{ parts: [{ text: 'p', refs: ['m1'] }] }] };
const USAGE = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2 };
const CALL_USD = 0.01;
const HOSTED = 'c1';
const LOCAL_ONLY = 'c2';

let db: Db;
beforeEach(() => {
  db = adoptSummaries(tempDb());
  seedArchive(db, [{ id: HOSTED }, { id: LOCAL_ONLY }]).ingestMessages(
    Array.from({ length: 3 }, (_, i) => rawMessage(HOSTED, Date.now() - MS_PER_MIN + i, `message ${i}`)),
    ARRIVAL.gateway,
  );
});

/** Providers by id, each recording its calls; `failing` ones throw; ollama alone may read LOCAL_ONLY. */
function setup(budgets: Partial<Record<ProviderId, number>>, failing: ProviderId[] = []) {
  const calls: Record<string, CompletionRequest[]> = {};
  const get = (id: ProviderId): LlmProvider => ({
    id,
    maxInputChars: budgets[id] ?? LARGE_BUDGET,
    complete: async (req): Promise<CompletionResult> => {
      (calls[id] ??= []).push(req);
      if (failing.includes(id)) throw new Error(`${id} is down`);
      // Each model writes its own draft, so a merge's input is that model's own.
      return { text: '', json: { ...DRAFT, headline: id }, usage: USAGE, apiCostUsd: CALL_USD };
    },
    listModels: async () => [],
  });
  const registry: SummaryProviders = {
    get,
    decider: () => null,
    permitted: (ids, reader) => ids.filter((c) => c !== LOCAL_ONLY || (reader !== 'hosted' && reader.provider === 'ollama')),
    localNames: () => ['Ollama'],
  };
  const s = new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => undefined);
  return { calls, comparer: new Comparer(db, s, registry, () => undefined) };
}

const PREFS = { ...DEFAULT_SUMMARY_SETTINGS };
const model = (provider: ProviderId, m: string | null = null, effort: string | null = null): CompareModel => ({ provider, model: m, effort });

describe('model comparison', () => {
  it('sends each model the same parts and prompts, cut at the smallest budget, with its own model and thinking level', async () => {
    const { calls, comparer } = setup({ codex: SMALL_BUDGET });
    const c = await comparer.run({ sinceTs: 0, models: [model('claude', 'opus', 'high'), model('codex', 'gpt', null)] }, DEFAULT_AI_SETTINGS, PREFS);
    // Every call but the last summarizes a part; the last merges that model's own drafts.
    const parts = (id: string) => calls[id]!.slice(0, -1).map(({ model: _m, effort: _e, ...sent }) => sent);
    const merge = (id: string) => calls[id]!.at(-1)!.prompt;
    expect(calls['claude']!.length).toBeGreaterThan(2); // parts and a merge, though claude alone would take one call
    expect(parts('claude')).toEqual(parts('codex'));
    expect(merge('claude')).not.toEqual(merge('codex'));
    expect(c.inputDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(c.results.map((r) => r.inputDigest)).toEqual([c.inputDigest, c.inputDigest]);
    expect(calls['claude']!.every((r) => r.model === 'opus' && r.effort === 'high')).toBe(true);
    expect(calls['codex']!.every((r) => r.model === 'gpt' && r.effort === undefined)).toBe(true);
    expect(c.results.map((r) => [r.model.provider, r.summary?.headline])).toEqual([['claude', 'claude'], ['codex', 'codex']]);
  });

  it('keeps the other columns when one model fails', async () => {
    const { comparer } = setup({}, ['codex']);
    const c = await comparer.run({ sinceTs: 0, models: [model('claude'), model('codex')] }, DEFAULT_AI_SETTINGS, PREFS);
    expect(c.results.map((r) => [r.summary !== null, r.error])).toEqual([[true, null], [false, 'codex is down']]);
    expect(c.failed).toBe(1);
  });

  it('refuses to mix local and hosted models over channels set to local AI only', async () => {
    const { calls, comparer } = setup({});
    const req = { sinceTs: 0, models: [model('claude'), model('ollama')] };
    await expect(comparer.run(req, DEFAULT_AI_SETTINGS, PREFS)).rejects.toThrow(/local and hosted/);
    expect(calls).toEqual({});
  });

  it('is listed, counts toward spending per finished column, and deletes on its own', async () => {
    const before = Date.now();
    const { comparer } = setup({}, ['codex']);
    const { id } = await comparer.run({ sinceTs: 0, models: [model('claude'), model('codex')] }, DEFAULT_AI_SETTINGS, PREFS);
    expect(comparer.list().map((h) => h.id)).toEqual([id]);
    expect(summarySpend(db, before).providers).toEqual([
      { provider: 'claude', runs: 1, ...USAGE, apiCostUsd: CALL_USD, unpricedRuns: 0 },
    ]);
    expect(comparer.delete(id)).toBe(true);
    expect(comparer.list()).toEqual([]);
    expect(comparer.get(id)).toBeNull();
  });
});
