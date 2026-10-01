// The Summarizer sends the effort set for the provider, or for the model Jev routes to.
import { archivePayloads } from '@core/plugins/archivePayloads';
import { adoptSummaries } from './summariesHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@shared/settings';
import { DEFAULT_SUMMARY_SETTINGS } from '../shared/settings';
import { MS_PER_MIN } from '@shared/units';
import { Summarizer } from '../core/summarize';
import type { CompletionRequest } from '@core/ai/types';
import { fakeRegistry } from './summariesHarness';
import { FakeJev, rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { ARRIVAL } from '@core/arrival';

describe('Summarizer effort', () => {
  let calls: CompletionRequest[];
  let jev: FakeJev;
  let summarizer: Summarizer;
  const settings = (effort: string | null): AiSettings => ({
    ...DEFAULT_AI_SETTINGS,
    defaultProvider: 'openrouter',
    providers: { ...DEFAULT_AI_SETTINGS.providers, openrouter: { enabled: true, model: 'base/model', effort, displayName: null } },
    jev: jev.on,
  });
  const prefs = (premiumEffort: string | null = null) => ({
    ...DEFAULT_SUMMARY_SETTINGS,
    jevRouting: { cheapModel: 'cheap/model', premiumModel: 'premium/model', cheapEffort: 'low', premiumEffort },
  });
  beforeEach(() => {
    const db = adoptSummaries(tempDb());
    jev = new FakeJev();
    seedArchive(db, [{ id: 'c1' }]).ingestMessages(Array.from({ length: 3 }, (_, i) => rawMessage('c1', Date.now() - MS_PER_MIN + i, `message ${i}`)), ARRIVAL.gateway);
    const fake = fakeRegistry(() => db, () => ({ headline: 'h', items: [{ parts: [{ text: 'p', refs: ['m1'] }] }] }), (_s, f) => jev.forPlugin('summaries')(f));
    calls = fake.calls;
    summarizer = new Summarizer(db, (ids) => archivePayloads(db, ids), fake.registry, () => {});
  });

  it('sends the chosen effort, none when unset, and a different effort is not served from cache', async () => {
    await summarizer.run({ sinceTs: 0 }, settings(null), prefs(), 'manual');
    await summarizer.run({ sinceTs: 0 }, settings('high'), prefs(), 'manual');
    expect(calls.map((c) => c.effort)).toEqual([undefined, 'high']);
  });

  it('a routed run uses the effort set for the routed model; changing it is not served from cache', async () => {
    jev.on['summaries.modelRouting'] = true;
    jev.values = { complexity: 1.8 };
    await summarizer.run({ sinceTs: 0 }, settings('high'), prefs(), 'manual');
    await summarizer.run({ sinceTs: 0 }, settings('high'), prefs('max'), 'manual');
    jev.values = { complexity: 0.3 };
    await summarizer.run({ sinceTs: 1 }, settings('high'), prefs(), 'manual');
    expect(calls.map((c) => c.effort)).toEqual([undefined, 'max', 'low']);
  });
});
