// Per-channel policy in Summaries: a local-AI-only channel never reaches a hosted provider.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiSettingsFrom } from '@shared/aiProviders';
import type { Archive } from '@core/archive';
import { ARRIVAL } from '@core/arrival';
import type { Db } from '@core/db';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { Summarizer } from '../core/summarize';
import { DEFAULT_SUMMARY_SETTINGS } from '../shared/settings';
import { adoptSummaries, fakeRegistry } from './summariesHarness';

// The provider plugins this plugin asks: stand-ins, since only the plugin under check is in the registry.
vi.mock('virtual:bundled-plugins/shared', async (build) => (await import('@chattypop/host-testing/fixtureProviders')).withFixtureProviders(build));

const PRIVATE = '200000000000000001';
const OPEN = '200000000000000002';
const THREAD = '300000000000000001';

let db: Db;
let archive: Archive;
beforeEach(() => {
  db = adoptSummaries(tempDb());
  archive = seedArchive(db, [{ id: PRIVATE }, { id: OPEN }]);
  archive.upsertThreads([{ id: THREAD, name: 'side talk', type: 11, parent_id: PRIVATE, last_message_id: null }], 0);
  archive.setChannelPolicy(PRIVATE, { localAiOnly: true, textTier: 'full' });
});

describe('per-channel policy', () => {
  it('leaves local-only channels out of hosted summaries', async () => {
    archive.ingestMessages([rawMessage(PRIVATE, Date.now() - 1000, 'secret plans')], ARRIVAL.gateway);
    const s = new Summarizer(db, (ids) => archivePayloads(db, ids), fakeRegistry(() => db, () => ({})).registry, () => {});
    // A fresh profile: the default is Claude, which runs hosted.
    await expect(s.run({ sinceTs: 0, channelIds: [PRIVATE] }, aiSettingsFrom({}), DEFAULT_SUMMARY_SETTINGS, 'manual')).rejects.toThrow(/local AI only/);
  });
});
