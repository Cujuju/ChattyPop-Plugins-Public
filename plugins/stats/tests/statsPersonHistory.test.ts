import { analyticsClient } from './analyticsClient';
import { statementRead } from '@chattypop/host-testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { DEFAULT_GUILD, testPlugin, type SeedArchive } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { peopleStats, personHistory } from '../core/personHistory';
import { PERSON_SILENCE_DAYS, QUIET_MIN_MESSAGES } from '../shared/personHistory';
import { STATS_TOP } from '../shared/types';
import { localDate, shiftLocalDay } from '../core/query';

const CHANNEL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;
const at = (day: number) => new Date(2026, 0, day).getTime();
const messages = (authorId: string, day: number, count = 1, channelId = 'c1') => Array.from({ length: count }, (_, i) => ({ channelId, ts: at(day) + i, content: '', authorId }));
function start(items: SeedArchive['messages']) {
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages: items } });
  onTestFinished(() => t.dispose());
  return { t, core: analyticsClient(t) };
}

describe('Analytics people history', () => {
  it('shares one SQL read between voice, history and streaks with exact partial-day range counts', async () => {
    const { t, core } = start([
      ...messages('a', 1, QUIET_MIN_MESSAGES), ...messages('a', 60, 2), ...messages('b', 60), ...messages('b', 90),
    ]);
    const query = { ...CHANNEL, sinceTs: at(60) + 1 };
    const prepare = vi.spyOn(t.db, 'prepare');
    const stats = (await peopleStats(statementRead(t.db), query));
    expect(stats.voice.buckets).toEqual((await core.activityStats(query)).buckets);
    expect(stats.voice.people.map((p) => [p.poster.userId, p.poster.count])).toEqual([['a', 1], ['b', 1]]);
    expect(stats.voice).toEqual(await core.voiceStats(query));
    expect(stats.history).toEqual(await core.personHistory(query));
    expect(stats.history.streaks).toEqual(await core.personStreaks(query));
  });

  it('ranks quiet posters and recent returns using whole-scope history and inclusive minimums', async () => {
    const { t, core } = start([
      ...messages('quiet', 59, QUIET_MIN_MESSAGES), ...messages('boundary', 60, QUIET_MIN_MESSAGES),
      ...messages('below', 59, QUIET_MIN_MESSAGES - 1),
      ...messages('long', 1), ...messages('long', 60),
      ...messages('edge', 29), ...messages('edge', 60), ...messages('edge', 61, 1, 't1'),
      ...messages('shortgap', 30), ...messages('shortgap', 60),
      ...messages('oldreturn', 1), ...messages('oldreturn', 59),
      ...Array.from({ length: PERSON_SILENCE_DAYS + 1 }, (_, i) => messages('neverleft', 60 + i)).flat(),
    ]);
    const prepare = vi.spyOn(t.db, 'prepare');
    const stats = (await personHistory(statementRead(t.db), { ...CHANNEL, sinceTs: at(80) }));
    expect([stats.archivedSince, stats.lastDay]).toEqual([at(1), '2026-03-31']);
    expect(stats.quiet.map((p) => [p.userId, p.count, p.lastSeen])).toEqual([['quiet', QUIET_MIN_MESSAGES, '2026-02-28']]);
    expect(stats.returned.map((p) => [p.userId, p.silenceDays, p.returned])).toEqual([
      ['long', 58, '2026-03-01'], ['edge', PERSON_SILENCE_DAYS, '2026-03-01'],
    ]);
    expect(stats.streaks).toEqual(await core.personStreaks({ ...CHANNEL, sinceTs: at(80) }));
    expect((await core.personHistory(CHANNEL)).quiet).toEqual(stats.quiet);
    expect((await core.personHistory(CHANNEL)).returned).toEqual(stats.returned);
  });

  it('uses only the latest consecutive-day run and excludes people without a prior silence', async () => {
    const { core } = start([
      ...messages('superseded', 1), ...messages('superseded', 32), ...messages('superseded', 34),
      ...messages('new', 34), ...messages('new', 35), ...messages('anchor', 40),
    ]);
    expect((await core.personHistory(CHANNEL)).returned).toEqual([]);
  });

  it('bounds both rankings with stable user-id ties', async () => {
    const ids = Array.from({ length: STATS_TOP + 1 }, (_, i) => `u${String(i).padStart(2, '0')}`);
    const { core } = start([
      ...ids.flatMap((id) => [...messages(`quiet-${id}`, 1, QUIET_MIN_MESSAGES), ...messages(id, 1), ...messages(id, 60)]),
      ...messages('anchor', 90),
    ]);
    const stats = await core.personHistory(CHANNEL);
    expect(stats.quiet.map((p) => p.userId)).toEqual(ids.slice(0, STATS_TOP).map((id) => `quiet-${id}`));
    expect(stats.returned.map((p) => p.userId)).toEqual(ids.slice(0, STATS_TOP));
  });

  it('shares exact-range active days while keeping historical lists independent of the range and privacy-aware', async () => {
    const { t, core } = start([
      ...messages('parent', 1, QUIET_MIN_MESSAGES), ...messages('returner', 1), ...messages('returner', 32, 1, 't1'),
      ...messages('same-day', 40, 2), ...messages('other', 50, 1, 'c2'), ...messages('private', 200, QUIET_MIN_MESSAGES, 'hidden'),
    ]);
    const query = { ...CHANNEL, sinceTs: at(40) + 1 };
    expect((await core.personHistory(query)).streaks).toEqual(await core.personStreaks(query));
    expect((await core.personHistory(query)).streaks.map((p) => p.userId)).toEqual(['same-day']);
    expect((await core.personHistory(query)).quiet.map((p) => p.userId)).toEqual(['parent']);
    t.archive.setPrivacyMode(true);
    const server = await core.personHistory({ ...CHANNEL, scope: 'server', guildId: DEFAULT_GUILD.id });
    expect(server.lastDay).toBe('2026-02-19');
    expect(server.quiet.some((p) => p.userId === 'private')).toBe(false);
    expect(server.returned.some((p) => p.userId === 'private')).toBe(false);
  });

  it('keeps local silence thresholds correct through daylight-saving boundaries', async () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      for (const startDate of ['2026-02-07', '2026-10-02']) {
        const returnDate = shiftLocalDay(startDate, PERSON_SILENCE_DAYS + 1);
        const { core } = start([
          { channelId: 'c1', ts: localDate(startDate).getTime(), authorId: 'returner', content: '' },
          { channelId: 'c1', ts: localDate(returnDate).getTime(), authorId: 'returner', content: '' },
        ]);
        expect((await core.personHistory(CHANNEL)).returned.map((p) => [p.silenceDays, p.returned])).toEqual([[PERSON_SILENCE_DAYS, returnDate]]);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('returns complete empty results and retains whole history when the selected range itself is empty', async () => {
    const empty = start([]);
    expect(await empty.core.personHistory(CHANNEL)).toEqual({ archivedSince: null, lastDay: null, streaks: [], quiet: [], returned: [] });
    const { core } = start([...messages('a', 1), ...messages('a', 32)]);
    expect(await core.personHistory({ ...CHANNEL, channelId: null })).toEqual({ archivedSince: null, lastDay: null, streaks: [], quiet: [], returned: [] });
    const stats = await core.personHistory({ ...CHANNEL, sinceTs: at(100) });
    expect(stats.streaks).toEqual([]);
    expect(stats.returned[0]?.silenceDays).toBe(PERSON_SILENCE_DAYS);
  });
});
