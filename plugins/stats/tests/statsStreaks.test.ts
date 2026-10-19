import { describe, expect, it, onTestFinished } from 'vitest';
import { DEFAULT_GUILD, testPlugin, type SeedArchive } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { dayStreaks } from '../core/streaks';
import { MS_PER_HOUR } from '@plugin-sdk/shared';
import { STATS_TOP, type ActivityQuery } from '../shared/types';
import { ALICE } from './statsFixture';

const CHANNEL: ActivityQuery = { scope: 'channel', channelId: 'c1', sinceTs: null };
const at = (month: number, day: number): number => new Date(2026, month - 1, day).getTime();

function start(messages: SeedArchive['messages']) {
  const t = testPlugin(statsCore, { archive: {
    channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages,
  } });
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}

describe('Analytics streaks and silences', () => {
  it('derives scope runs and silent dates from the existing histogram across months and DST', async () => {
    const { core } = start([
      ...[30, 31].map((day) => ({ channelId: 'c1', ts: at(1, day), content: 'January' })),
      { channelId: 't1', ts: at(2, 1), content: 'February' },
      ...[7, 8, 9].map((day) => ({ channelId: 'c1', ts: at(3, day), content: 'DST' })),
      ...[12, 13].map((day) => ({ channelId: 'c1', ts: at(3, day), content: 'last run' })),
    ]);
    expect((await core.activityStats(CHANNEL)).streaks).toEqual({
      longest: { days: 3, start: '2026-01-30', end: '2026-02-01' },
      current: { days: 2, start: '2026-03-12', end: '2026-03-13' },
      gap: { days: 33, start: '2026-02-02', end: '2026-03-06' },
    });
    expect((await core.activityStats({ ...CHANNEL, sinceTs: at(3, 7) })).streaks).toEqual({
      longest: { days: 3, start: '2026-03-07', end: '2026-03-09' },
      current: { days: 2, start: '2026-03-12', end: '2026-03-13' },
      gap: { days: 2, start: '2026-03-10', end: '2026-03-11' },
    });
  });

  it('uses calendar increments for both spring and autumn daylight-saving boundaries', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(dayStreaks(['2026-03-07', '2026-03-08', '2026-03-09']).longest?.days).toBe(3);
      expect(dayStreaks(['2026-10-31', '2026-11-01', '2026-11-02']).longest?.days).toBe(3);
      expect(dayStreaks(['2026-03-07', '2026-03-10']).gap).toEqual({ days: 2, start: '2026-03-08', end: '2026-03-09' });
      const springHours = (at(3, 9) - at(3, 8)) / MS_PER_HOUR;
      const autumnHours = (at(11, 2) - at(11, 1)) / MS_PER_HOUR;
      expect([springHours, autumnHours]).toEqual([23, 25]);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('ranks each person by longest distinct-day run, then earlier start and user id', async () => {
    const { core } = start([
      ...['u2', 'u1'].flatMap((authorId) => [30, 31].map((day) => ({ channelId: 'c1', ts: at(1, day), authorId, content: 'day',
        ...(authorId === ALICE.id ? { extra: { author: ALICE } } : {}) }))),
      { channelId: 't1', ts: at(2, 1), authorId: 'u1', content: 'third', extra: { author: ALICE } },
      { channelId: 'c1', ts: at(2, 1), authorId: 'u2', content: 'third' },
      { channelId: 'c1', ts: at(2, 1) + 1, authorId: 'u1', content: 'same day', extra: { author: ALICE } },
      ...[7, 8, 9].map((day) => ({ channelId: 'c1', ts: at(3, day), authorId: 'u0', content: 'later run' })),
    ]);
    const streaks = await core.personStreaks(CHANNEL);
    expect(streaks).toEqual([
      { userId: 'u1', name: 'Alice', avatar: ALICE.avatar, days: 3, start: '2026-01-30', end: '2026-02-01' },
      { userId: 'u2', name: 'u2', avatar: null, days: 3, start: '2026-01-30', end: '2026-02-01' },
      { userId: 'u0', name: 'u0', avatar: null, days: 3, start: '2026-03-07', end: '2026-03-09' },
    ]);
    expect(streaks[0]?.avatar).toBe(ALICE.avatar);
  });

  it('keeps the earliest tied streak and gap and treats one active day as a one-day run', async () => {
    expect(dayStreaks(['2026-02-07', '2026-02-01', '2026-02-04', '2026-02-01'])).toEqual({
      longest: { days: 1, start: '2026-02-01', end: '2026-02-01' },
      current: { days: 1, start: '2026-02-07', end: '2026-02-07' },
      gap: { days: 2, start: '2026-02-02', end: '2026-02-03' },
    });
    const { core } = start([{ channelId: 'c1', ts: at(2, 1), content: '' }]);
    const run = { days: 1, start: '2026-02-01', end: '2026-02-01' };
    expect((await core.activityStats(CHANNEL)).streaks).toEqual({ longest: run, current: run, gap: null });
    expect(await core.personStreaks(CHANNEL)).toEqual([{ userId: 'u1', name: 'Alice', avatar: null, ...run }]);
  });

  it('applies hidden channels, parent threads, server and range scope to distinct person/date pairs', async () => {
    const { t, core } = start([
      { channelId: 'c1', ts: at(2, 1), content: 'parent' },
      { channelId: 't1', ts: at(2, 2), content: 'thread' },
      { channelId: 'c2', ts: at(2, 3), content: 'other' },
      { channelId: 'hidden', ts: at(2, 4), content: 'private', authorId: 'private' },
    ]);
    t.archive.setPrivacyMode(true);
    expect((await core.personStreaks(CHANNEL))[0]?.days).toBe(2);
    expect((await core.personStreaks({ ...CHANNEL, scope: 'server', guildId: DEFAULT_GUILD.id }))[0]?.days).toBe(3);
    expect(await core.personStreaks({ ...CHANNEL, scope: 'all', sinceTs: at(2, 2) })).toEqual([
      { userId: 'u1', name: 'Alice', avatar: null, days: 2, start: '2026-02-02', end: '2026-02-03' },
    ]);
    expect((await core.activityStats({ ...CHANNEL, scope: 'all' })).streaks.longest?.days).toBe(3);
  });

  it('bounds the person ranking and returns complete empty scope results', async () => {
    const { core } = start(Array.from({ length: STATS_TOP + 2 }, (_, index) => ({
      channelId: 'c1', ts: at(2, 1), content: '', authorId: `u${String(index).padStart(2, '0')}`,
    })));
    expect((await core.personStreaks(CHANNEL)).map((p) => p.userId)).toEqual(Array.from({ length: STATS_TOP }, (_, i) => `u${String(i).padStart(2, '0')}`));
    for (const query of [{ ...CHANNEL, channelId: null }, { ...CHANNEL, sinceTs: at(2, 2) }]) {
      expect(await core.personStreaks(query)).toEqual([]);
      expect((await core.activityStats(query)).streaks).toEqual({ longest: null, current: null, gap: null });
    }
    const empty = start([]);
    expect(await empty.core.personStreaks(CHANNEL)).toEqual([]);
  });
});
