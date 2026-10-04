// People in summary text (#291, #303): the log tags each person, the model writes tags, core stores each tag the log
// gave out as the person (shown by their name now), and the owner can name a person the tags missed.
import { archivePayloads } from '@core/plugins/archivePayloads';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@core/db';
import type { Archive } from '@core/archive';
import { MS_PER_DAY } from '@shared/units';
import { ARRIVAL } from '@core/arrival';
import { aiSettingsFrom } from '@shared/aiProviders';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { adoptSummaries, fakeRegistry, TEST_PREFS } from './summariesHarness';
import { Summarizer } from '../core/summarize';
import { linkMarked, linkNames, peopleByName, peopleByTag, unmarked } from '../core/people';
import { linkPerson } from '../core/linkPerson';
import { namedText, textRuns } from '../shared/people';

vi.mock('virtual:bundled-plugins/shared', async (build) => (await import('@chattypop/host-testing/fixtureProviders')).withFixtureProviders(build));

const GUILD = 'g1';
const GENERAL = '200000000000000001';
const SAL = { id: '400000000000000001', username: 'salchipapa', global_name: 'Salchipapa' };
const STAT = { id: '400000000000000002', username: 'stat', global_name: 'stat' };
const SINCE = Date.now() - 3 * MS_PER_DAY;

describe('people in summary text', () => {
  it('links tags the log gave out, a name only one person holds, and no tag it never gave out', () => {
    const byName = peopleByName([['Sam', '1'], ['Kim', '2'], ['Kim', '3'], ['Sam', '1']]);
    expect([...byName]).toEqual([['Sam', '1']]);
    const byTag = peopleByTag([{ tag: 'p1', userId: '2', name: 'Kim' }, { tag: 'p2', userId: '3', name: 'Kim' }]);
    expect(linkMarked("{{p1}} and {{p2}}, {{p9}}; {{Sam}}'s fix, {{Kim}} and {{Lee}}", byTag, byName)).toBe("<@2> and <@3>, someone; <@1>'s fix, Kim and Lee");
    expect(unmarked('{{p2}} asked {{p9}} and {{Lee}}', byTag)).toBe('Kim asked someone and Lee');
  });

  it('links whole names, longest first, never inside a word', () => {
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
  const run = (s: Summarizer) => s.run({ sinceTs: SINCE }, aiSettingsFrom({}), { ...TEST_PREFS, actionItems: false }, 'manual');

  it('tags people in the log and stores the tags the model writes as people', async () => {
    const { calls, registry } = fakeRegistry(() => db, () => ({ headline: '{{p1}} got the knife', items: [{ parts: [{ text: '{{p2}} cheered {{p1}}', refs: ['m1'] }] }] }));
    const summary = await run(new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => {}));
    expect(calls[0]!.prompt).toContain(`Salchipapa {{p1}}: knife arrived`);
    expect(calls[0]!.prompt).toContain(`stat {{p2}}: @Salchipapa {{p1}} nice`);
    expect(summary.headline).toBe(`<@${SAL.id}> got the knife`);
    expect(summary.items[0]!.parts[0]!.text).toBe(`<@${STAT.id}> cheered <@${SAL.id}>`);
  });

  it('stores marked names as people and shows their server nickname, live', async () => {
    const s = summarizer('{{p1}} got the knife', '{{p2}} cheered {{p1}}');
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

  it("links the owner's naming of a person in one summary, only for someone the archive knows", async () => {
    const s = summarizer('Sal got the knife; Salty', 'stat cheered Sal');
    const { id } = await run(s);
    expect(linkPerson(db, id, 'Sal', '400000000000000404')).toBe(0);
    expect(linkPerson(db, id, 'Sal', SAL.id)).toBe(2);
    const [shown] = s.page({ limit: 1 });
    expect(shown!.headline).toBe(`<@${SAL.id}> got the knife; Salty`);
    expect(shown!.items[0]!.parts[0]!.text).toBe(`stat cheered <@${SAL.id}>`);
    expect(linkPerson(db, id, 'Sal', SAL.id)).toBe(0);
  });
});
