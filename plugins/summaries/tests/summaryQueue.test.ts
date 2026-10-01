// A summary queued behind another resolves the default provider when it starts, not when it was queued.
import { describe, expect, it } from 'vitest';
import { normalizeAiSettings } from '@shared/settings';
import { declaredProviders } from '@shared/aiProviders';
import { MS_PER_MIN } from '@shared/units';
import { ProviderRegistry } from '@core/ai/registry';
import { aiSources } from '@core/ai/readScope';
import type { ProviderImpl } from '@core/ai/types';
import { ARRIVAL } from '@core/arrival';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { Summarizer } from '../core/summarize';
import { DEFAULT_SUMMARY_SETTINGS } from '../shared/settings';
import { adoptSummaries } from './summariesHarness';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';

const ANSWER = JSON.stringify({ headline: 'h', items: [{ parts: [{ text: 'p', refs: [] }] }] });

describe('queued summaries', () => {
  it("use the default that can run when they start; the queued-time default's plugin was turned off meanwhile", async () => {
    const db = adoptSummaries(tempDb());
    seedArchive(db, [{ id: 'c1' }]).ingestMessages([rawMessage('c1', Date.now() - MS_PER_MIN, 'hello')], ARRIVAL.gateway);
    const registry = new ProviderRegistry(() => undefined, declaredProviders());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const used: string[] = [];
    const impl = (id: string, wait: boolean): ProviderImpl => ({
      create: () => ({
        id,
        maxInputChars: 100_000,
        complete: async () => {
          used.push(id);
          if (wait) await gate;
          return { text: ANSWER, json: JSON.parse(ANSWER) };
        },
        listModels: async () => [],
      }),
      status: async () => ({ available: true, detail: '', models: [] }),
    });
    registry.register('claude', impl('claude', false));
    const offCodex = registry.register('codex', impl('codex', true));
    const summarizer = new Summarizer(db, (ids) => archivePayloads(db, ids), {
      get: (id, s) => registry.get(id, s),
      decider: () => null,
      permitted: aiSources(() => db, (id) => registry.isLocal(id)).permitted,
      localNames: () => [],
      effective: (s) => registry.effective(s),
    }, () => undefined);
    const settings = registry.effective(normalizeAiSettings({ defaultProvider: 'codex', providers: { claude: { enabled: true }, codex: { enabled: true } } }, declaredProviders()));
    const first = summarizer.run({ sinceTs: 0 }, settings, DEFAULT_SUMMARY_SETTINGS, 'manual');
    const queued = summarizer.run({ sinceTs: 1 }, settings, DEFAULT_SUMMARY_SETTINGS, 'manual');
    await expect.poll(() => used).toEqual(['codex']);
    offCodex();
    release();
    await expect(first).rejects.toThrow(/which is off/);
    await expect(queued).resolves.toMatchObject({ provider: 'claude' });
    expect(used).toEqual(['codex', 'claude']);
  });
});
