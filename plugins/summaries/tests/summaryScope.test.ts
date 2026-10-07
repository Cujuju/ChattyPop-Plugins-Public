// Contract: a scope narrows what a run reads (a server's channels, a channel with its threads) and stays on the run.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiSettingsFrom } from '@shared/aiProviders';
import { MS_PER_MIN } from '@shared/units';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { ARRIVAL } from '@core/arrival';
import type { Db } from '@core/db';
import { Summarizer } from '../core/summarize';
import type { SummaryScope } from '../shared/types';
import { adoptSummaries, fakeRegistry, TEST_PREFS } from './summariesHarness';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';

/** A Discord public thread's channel type. */
const PUBLIC_THREAD = 11;
const SERVER_A = '300000000000000001';
const SERVER_B = '300000000000000002';
const GENERAL = '300000000000000011';
const THREAD = '300000000000000012';
const OTHER = '300000000000000013';
const ELSEWHERE = '300000000000000021';
const DRAFT = { headline: 'h', items: [] };
/** A fresh profile's AI settings: Claude is the default. */
const FRESH_AI = aiSettingsFrom({});

// The provider plugins this plugin asks: stand-ins, since only the plugin under check is in the registry.
vi.mock('virtual:bundled-plugins/shared', async (build) => (await import('@chattypop/host-testing/fixtureProviders')).withFixtureProviders(build));

let db: Db;
beforeEach(() => {
  db = adoptSummaries(tempDb());
  const archive = seedArchive(
    db,
    [{ id: GENERAL, guildId: SERVER_A }, { id: OTHER, guildId: SERVER_A }, { id: ELSEWHERE, guildId: SERVER_B }],
    { guilds: [{ id: SERVER_A, name: 'A' }, { id: SERVER_B, name: 'B' }] as never },
  );
  archive.upsertChannels(SERVER_A, [{ id: THREAD, name: 'thread', type: PUBLIC_THREAD, parent_id: GENERAL }] as never);
  archive.setOptIn(THREAD, true);
  const t = Date.now() - MS_PER_MIN;
  archive.ingestMessages([GENERAL, THREAD, OTHER, ELSEWHERE].map((c, i) => rawMessage(c, t + i, `said in ${c}`)), ARRIVAL.gateway);
});

/** Runs one summary over `scope` and returns what the model read and the stored run. */
async function run(req: { scope?: SummaryScope; channelIds?: string[] }) {
  const { calls, registry } = fakeRegistry(() => db, () => DRAFT);
  const s = new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => undefined);
  const summary = await s.run({ sinceTs: 0, ...req }, FRESH_AI, TEST_PREFS, 'manual');
  return { prompt: calls.map((c) => c.prompt).join('\n'), summary };
}

describe('summary scope', () => {
  it('reads one channel with its threads, and names that scope on the run', async () => {
    const scope = { guildIds: [], channelIds: [GENERAL] };
    const { prompt, summary } = await run({ scope });
    expect(prompt).toContain(`said in ${GENERAL}`);
    expect(prompt).toContain(`said in ${THREAD}`);
    expect(prompt).not.toContain(`said in ${OTHER}`);
    expect(prompt).not.toContain(`said in ${ELSEWHERE}`);
    expect(summary.scope).toEqual(scope);
  });

  it("reads a whole server's channels and nothing from another server", async () => {
    const { prompt } = await run({ scope: { guildIds: [SERVER_B], channelIds: [] } });
    expect(prompt).toContain(`said in ${ELSEWHERE}`);
    expect(prompt).not.toContain(`said in ${GENERAL}`);
  });

  it("keeps a rule's channels as its scope, and none for everything", async () => {
    expect((await run({ channelIds: [OTHER] })).summary.scope).toEqual({ guildIds: [], channelIds: [OTHER] });
    const all = await run({});
    expect(all.summary.scope).toBeNull();
    expect(all.prompt).toContain(`said in ${ELSEWHERE}`);
  });
});
