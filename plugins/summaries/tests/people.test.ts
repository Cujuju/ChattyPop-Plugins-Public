// People in summary text (#291): marked names are stored as the person, shown by their name now, and old summaries are
// linked once by the names their log held.
import { archivePayloads } from '@core/plugins/archivePayloads';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@core/db';
import type { Archive } from '@core/archive';
import { MS_PER_DAY } from '@shared/units';
import { ARRIVAL } from '@core/arrival';
import { aiSettingsFrom } from '@shared/aiProviders';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { adoptSummaries, fakeRegistry } from './summariesHarness';
import { Summarizer } from '../core/summarize';
import { SUMMARIES_TABLE } from '../core/schema';
import { linkMarked, linkNames, peopleByName } from '../core/people';
import { linkStoredPeople } from '../core/linkStored';
import { DEFAULT_SUMMARY_SETTINGS } from '../shared/settings';
import { namedText, textRuns } from '../shared/people';

vi.mock('virtual:bundled-plugins/shared', async (build) => (await import('@chattypop/host-testing/fixtureProviders')).withFixtureProviders(build));

const GUILD = 'g1';
const GENERAL = '200000000000000001';
const SAL = { id: '400000000000000001', username: 'salchipapa', global_name: 'Salchipapa' };
const STAT = { id: '400000000000000002', username: 'stat', global_name: 'stat' };
const SINCE = Date.now() - 3 * MS_PER_DAY;

describe('people in summary text', () => {
  it('links only names one person holds, and unwraps marks it cannot place', () => {
    const byName = peopleByName([['Sam', '1'], ['Kim', '2'], ['Kim', '3'], ['Sam', '1']]);
    expect([...byName]).toEqual([['Sam', '1']]);
    expect(linkMarked("{{Sam}}'s fix, {{Kim}} and {{Lee}}", byName)).toBe("<@1>'s fix, Kim and Lee");
  });

  it('links whole names in old text, longest first, never inside a word', () => {
    const byName = new Map([['stat', '1'], ['stat [WWW]', '2'], ['Sal', '3']]);
    expect(linkNames('stat [WWW] and stat met Salchipapa; statistics', byName)).toBe('<@2> and <@1> met Salchipapa; statistics');
  });

  it('splits text into runs and writes names into plain text', () => {
    expect(textRuns('<@1> asked <@2>.')).toEqual([{ userId: '1' }, ' asked ', { userId: '2' }, '.']);
    expect(namedText('<@1> asked <@9>', { '1': '🦐' })).toBe('🦐 asked <@9>');
  });
});

describe('summaries name people as they are now', () => {
  let db: Db;
  let archive: Archive;
  beforeEach(() => {
    db = adoptSummaries(tempDb());
    archive = seedArchive(db, [{ id: GENERAL, name: 'general' }]);
    archive.upsertMembers(GUILD, [{ user: SAL, nick: '🦐' }]);
    const t0 = Date.now() - 2 * MS_PER_DAY;
    archive.ingestMessages([
      rawMessage(GENERAL, t0, 'knife arrived', { author: SAL }),
      rawMessage(GENERAL, t0 + 1000, `<@${SAL.id}> nice`, { author: STAT }),
    ], ARRIVAL.gateway);
  });

  const summarizer = (headline: string, text: string): Summarizer => {
    const { registry } = fakeRegistry(() => db, (req) => {
      const refs = [...req.prompt.matchAll(/\[(m\d+)\]/g)].map((m) => m[1]!);
      return { headline, items: [{ parts: [{ text, refs }] }] };
    });
    return new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => {});
  };
  const run = (s: Summarizer) => s.run({ sinceTs: SINCE }, aiSettingsFrom({}), { ...DEFAULT_SUMMARY_SETTINGS, actionItems: false }, 'manual');

  it('stores marked names as people and shows their server nickname, live', async () => {
    const s = summarizer('{{Salchipapa}} got the knife', '{{stat}} cheered {{Salchipapa}}');
    const summary = await run(s);
    expect(summary.headline).toBe(`<@${SAL.id}> got the knife`);
    expect(summary.items[0]!.parts[0]!.text).toBe(`<@${STAT.id}> cheered <@${SAL.id}>`);
    expect(summary.people).toEqual({ [SAL.id]: '🦐', [STAT.id]: 'stat' });
    // Sources carry their authors.
    expect(Object.values(summary.authors).sort()).toEqual([SAL.id, STAT.id]);

    archive.upsertMembers(GUILD, [{ user: SAL, nick: '🍤' }]);
    const [shown] = s.page({ limit: 1 });
    expect(namedText(shown!.headline, shown!.people)).toBe('🍤 got the knife');
  });

  it('links summaries stored before names were marked, once', async () => {
    const s = summarizer('Salchipapa got the knife', 'stat cheered Salchipapa');
    const { id } = await run(s);
    db.prepare(`UPDATE ${SUMMARIES_TABLE} SET people_linked = 0 WHERE id = ?`).run(id);

    expect(await linkStoredPeople(db, () => false)).toBe(1);
    const [shown] = s.page({ limit: 1 });
    expect(shown!.headline).toBe(`<@${SAL.id}> got the knife`);
    expect(shown!.items[0]!.parts[0]!.text).toBe(`<@${STAT.id}> cheered <@${SAL.id}>`);
    expect(await linkStoredPeople(db, () => false)).toBe(0);
  });
});
