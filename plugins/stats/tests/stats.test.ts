// The Analytics plugin's counts, as a desktop window asks its core side for them over a seeded archive.
import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_DAY } from '@shared/units';
import statsCore from '../core';
import type { ActivityQuery } from '../shared/types';
import { EDIT_DELAY_BUCKETS, POSTERS_PAGE_MAX, STATS_TOP } from '../shared/types';
import { analyticsArchive, BEFORE_YEAR, JANUARY_START, MARCH_START } from './statsFixture';

/** A local time in September 2026 (month index 8). */
const at = (day: number, hour: number): number => new Date(2026, 8, day, hour).getTime();
const BOB = { authorId: 'u2', authorName: 'Bob' };
const HOME = { id: '100000000000000001', name: 'Home' };
const AWAY = { id: '100000000000000002', name: 'Away' };
/** Far enough back that the server's span needs weekly buckets. */
const LONG_AGO_DAYS = 200;

function start() {
  const t = testPlugin(statsCore, {
    archive: {
      guilds: [HOME, AWAY],
      channels: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3', guildId: AWAY.id }, { id: 't1', name: 'side', parentId: 'c1' }],
      messages: [
        { channelId: 'c1', ts: at(7, 9), content: 'mon https://www.youtube.com/watch?v=1' }, // Monday
        { channelId: 'c1', ts: at(7, 9) + 1, content: 'mon again https://youtube.com/watch?v=2' },
        { channelId: 't1', ts: at(8, 22), content: 'thread https://x.com/a/status/1', ...BOB },
        { channelId: 'c2', ts: at(13, 15), content: 'sunday', ...BOB },
        { channelId: 'c3', ts: at(13, 15) + 1, content: 'elsewhere' },
      ],
    },
  });
  onTestFinished(() => t.dispose());
  return { t, stats: (q: ActivityQuery) => t.client('renderer').activityStats(q) };
}

describe('activity stats', () => {
  it('counts a channel with its threads, by day, weekday and hour in local time', async () => {
    const s = await start().stats({ scope: 'channel', channelId: 'c1', sinceTs: null });
    expect([s.messages, s.authors, s.bucket]).toEqual([3, 2, 'day']);
    expect(s.buckets).toEqual([
      { start: '2026-09-07', count: 2 },
      { start: '2026-09-08', count: 1 },
    ]);
    expect(s.heatmap[1]![9]).toBe(2); // Monday 09:00
    expect(s.heatmap[2]![22]).toBe(1); // Tuesday 22:00
    expect(s.posters.map((p) => [p.name, p.count])).toEqual([
      ['Alice', 2],
      ['Bob', 1],
    ]);
  });

  it('groups link shares by site while folding leading www hosts', async () => {
    expect((await start().stats({ scope: 'all', channelId: null, sinceTs: null })).domains).toEqual([
      { domain: 'youtube.com', count: 2, hosts: [{ host: 'youtube.com', count: 2 }] },
      { domain: 'x.com', count: 1, hosts: [{ host: 'x.com', count: 1 }] },
    ]);
  });

  it('scopes to the channel’s server, and to a time range', async () => {
    const { stats } = start();
    expect((await stats({ scope: 'server', channelId: 'c2', sinceTs: null })).messages).toBe(4);
    expect((await stats({ scope: 'all', channelId: null, sinceTs: at(13, 0) })).messages).toBe(2);
  });

  it('counts nothing for a channel scope with no channel open', async () => {
    const { stats } = start();
    expect((await stats({ scope: 'channel', channelId: null, sinceTs: null })).messages).toBe(0);
    expect((await stats({ scope: 'server', channelId: null, sinceTs: null })).messages).toBe(0);
  });

  it('groups long spans by week starting Monday', async () => {
    const { t, stats } = start();
    t.archive.arrive([{ channelId: 'c2', ts: at(1, 12) - LONG_AGO_DAYS * MS_PER_DAY, content: 'long ago' }]);
    const s = await stats({ scope: 'server', channelId: 'c2', sinceTs: null });
    expect(s.bucket).toBe('week');
    // Sun Sep 13 belongs to the week of Mon Sep 7.
    expect(s.buckets.at(-1)).toEqual({ start: '2026-09-07', count: 4 });
  });
});

function analytics() {
  const t = testPlugin(statsCore, { archive: analyticsArchive() });
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}

const CHANNEL: ActivityQuery = { scope: 'channel', channelId: 'c1', sinceTs: null };
const EVERYTHING: ActivityQuery = { scope: 'all', channelId: null, sinceTs: null };

describe('Analytics additions', () => {
  it('reports the archive start across ranges and respects visible scope', async () => {
    const { t, core } = analytics();
    expect((await core.activityStats(CHANNEL)).archivedSince).toBe(BEFORE_YEAR);
    expect((await core.activityStats({ ...CHANNEL, sinceTs: MARCH_START })).archivedSince).toBe(BEFORE_YEAR);
    expect((await core.activityStats({ ...CHANNEL, sinceTs: Date.now() + MS_PER_DAY })).archivedSince).toBe(BEFORE_YEAR);
    expect((await core.activityStats({ ...CHANNEL, channelId: null })).archivedSince).toBeNull();
    expect((await core.activityStats(EVERYTHING)).archivedSince).toBe(BEFORE_YEAR - MS_PER_DAY);
    t.archive.setPrivacyMode(true);
    expect((await core.activityStats(EVERYTHING)).archivedSince).toBe(BEFORE_YEAR);
  });
  it('counts local active dates, edits, text, linked messages and attachment messages without multiplying messages', async () => {
    const s = await analytics().core.activityStats(CHANNEL);
    expect(s.query).toEqual(CHANNEL);
    expect([s.messages, s.authors, s.activeDays, s.editedMessages, s.textMessages, s.linkedMessages, s.attachmentMessages])
      .toEqual([5, 2, 3, 4, 4, 4, 3]);
    expect(s.posters).toEqual([
      { userId: 'u1', name: 'Alice', avatar: 'alice-avatar', count: 3 },
      { userId: 'u2', name: 'Bob', avatar: null, count: 2 },
    ]);
  });

  it('reports the single busiest local hour, day, month and year, breaking ties by earliest start', async () => {
    const s = await analytics().core.activityStats(CHANNEL);
    expect(s.mostActive).toEqual({
      hour: { start: '2026-01-01T00:00:00', count: 2 },
      day: { start: '2026-01-01', count: 2 },
      month: { start: '2026-01-01', count: 2 },
      year: { start: '2026-01-01', count: 4 },
    });
    expect(s.activeDays).toBe(new Set([BEFORE_YEAR, JANUARY_START].map((ts) => new Date(ts).toDateString())).size + 1);
  });

  it('ranks channels and link shares by person and channel with the domains join', async () => {
    const s = await analytics().core.activityStats(CHANNEL);
    expect(s.channels).toEqual([{ channelId: 'c1', name: 'General', count: 4 }, { channelId: 't1', name: 'Thread', count: 1 }]);
    expect(s.linksByPerson.map((p) => [p.userId, p.avatar, p.count])).toEqual([['u1', 'alice-avatar', 4], ['u2', null, 2]]);
    expect(s.linksByChannel).toEqual([{ channelId: 'c1', name: 'General', count: 6 }]);
    expect(s.domains).toEqual([
      { domain: 'shared.example', count: 3, hosts: [{ host: 'shared.example', count: 3 }] },
      { domain: 'second.example', count: 2, hosts: [{ host: 'second.example', count: 2 }] },
      { domain: 'third.example', count: 1, hosts: [{ host: 'third.example', count: 1 }] },
    ]);
  });

  it('assigns edit delay boundaries and attachment MIME kinds, including missing MIME metadata', async () => {
    const { core } = analytics();
    const s = await core.activityStats(CHANNEL);
    expect(s.editDelay).toEqual(EDIT_DELAY_BUCKETS.map((b) => ({ id: b.id, count: b.id === 'day' ? 0 : 1 })));
    expect(s.attachmentTypes).toEqual([
      { kind: 'image', count: 1 }, { kind: 'video', count: 1 }, { kind: 'audio', count: 1 }, { kind: 'other', count: 1 },
    ]);
    const all = await core.activityStats(EVERYTHING);
    expect(all.editDelay.map((b) => b.count)).toEqual([1, 2, 1, 1, 1]);
  });

  it('fills empty local months and finds first posters across the whole scope before filtering the range', async () => {
    const { core } = analytics();
    expect((await core.activityStats(CHANNEL)).timeline).toEqual([
      { start: '2025-12-01', activePosters: 1, newPosters: 1 },
      { start: '2026-01-01', activePosters: 2, newPosters: 1 },
      { start: '2026-02-01', activePosters: 0, newPosters: 0 },
      { start: '2026-03-01', activePosters: 2, newPosters: 0 },
    ]);
    const s = await core.activityStats({ ...CHANNEL, sinceTs: MARCH_START });
    expect(s.timeline).toEqual([{ start: '2026-03-01', activePosters: 2, newPosters: 0 }]);
    const all = await core.activityStats({ ...EVERYTHING, sinceTs: JANUARY_START });
    expect(all.timeline[0]).toEqual({ start: '2026-01-01', activePosters: 4, newPosters: 2 });
  });

  it('applies server and range scope to every new summary', async () => {
    const s = await analytics().core.activityStats({ scope: 'server', channelId: 'c2', sinceTs: JANUARY_START });
    expect([s.messages, s.authors, s.activeDays, s.editedMessages, s.textMessages, s.linkedMessages, s.attachmentMessages])
      .toEqual([5, 3, 3, 4, 3, 3, 2]);
    expect(s.channels.map((c) => [c.channelId, c.count])).toEqual([['c1', 3], ['c2', 1], ['t1', 1]]);
    expect(s.editDelay.map((b) => b.count)).toEqual([0, 1, 1, 1, 1]);
    expect(s.attachmentTypes.map((a) => a.count)).toEqual([0, 1, 1, 1]);
    expect(s.linksByPerson.map((p) => [p.userId, p.count])).toEqual([['u1', 3], ['u2', 2]]);
    expect(s.linksByChannel).toEqual([{ channelId: 'c1', name: 'General', count: 5 }]);
    expect(s.timeline).toEqual([
      { start: '2026-01-01', activePosters: 3, newPosters: 1 },
      { start: '2026-02-01', activePosters: 0, newPosters: 0 },
      { start: '2026-03-01', activePosters: 2, newPosters: 0 },
    ]);
    expect(s.mostActive).toEqual({
      hour: { start: '2026-01-01T00:00:00', count: 2 },
      day: { start: '2026-01-01', count: 2 },
      month: { start: '2026-01-01', count: 3 },
      year: { start: '2026-01-01', count: 5 },
    });
  });

  it('preserves visible later link shares when the first share is hidden', async () => {
    const { t, core } = analytics();
    t.archive.setPrivacyMode(true);
    const s = await core.activityStats(EVERYTHING);
    expect([s.messages, s.authors, s.activeDays, s.linkedMessages]).toEqual([8, 4, 4, 4]);
    expect(s.domains.find((d) => d.domain === 'shared.example')?.count).toBe(3);
    expect(s.channels.some((c) => c.channelId === 'hidden')).toBe(false);
    expect(s.linksByPerson.some((p) => p.userId === 'private')).toBe(false);
    expect((await core.postersPage({ ...EVERYTHING, offset: 0, limit: POSTERS_PAGE_MAX })).some((p) => p.userId === 'private')).toBe(false);
  });

  it('keeps server scope on a DM to that conversation', async () => {
    const { t, core } = analytics();
    t.db.prepare('UPDATE channels SET guild_id = NULL WHERE id = ?').run('c3');
    const q: ActivityQuery = { scope: 'server', channelId: 'c3', sinceTs: null };
    const s = await core.activityStats(q);
    expect([s.messages, s.activeDays, s.editedMessages, s.textMessages, s.linkedMessages, s.attachmentMessages]).toEqual([1, 1, 1, 1, 0, 0]);
    expect(s.channels).toEqual([{ channelId: 'c3', name: 'Away', count: 1 }]);
    expect(s.timeline).toEqual([{ start: '2026-01-01', activePosters: 1, newPosters: 1 }]);
    expect((await core.postersPage({ ...q, offset: 0, limit: STATS_TOP })).map((p) => p.userId)).toEqual(['u4']);
  });

  it('returns complete empty summaries for absent channel scopes and empty ranges', async () => {
    const { core } = analytics();
    for (const q of [{ ...CHANNEL, channelId: null }, { ...CHANNEL, sinceTs: Date.now() + MS_PER_DAY }]) {
      const s = await core.activityStats(q);
      expect([s.messages, s.authors, s.activeDays, s.editedMessages, s.textMessages, s.linkedMessages, s.attachmentMessages]).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(Object.values(s.mostActive)).toEqual([null, null, null, null]);
      expect([s.posters, s.channels, s.linksByPerson, s.linksByChannel, s.timeline]).toEqual([[], [], [], [], []]);
      expect(s.editDelay.every((b) => b.count === 0)).toBe(true);
      expect(s.attachmentTypes.every((b) => b.count === 0)).toBe(true);
      expect(await core.postersPage({ ...q, offset: 0, limit: STATS_TOP })).toEqual([]);
    }
  });

  it('pages all ranked posters beyond the top ten with stable ties, scope and range', async () => {
    const { t, core } = analytics();
    const MANY_POSTERS = STATS_TOP + 3;
    t.archive.arrive(Array.from({ length: MANY_POSTERS }, (_, index) => ({
      channelId: 't1', ts: JANUARY_START, authorId: `poster-${String(index).padStart(2, '0')}`, content: 'hello',
    })));
    const q = { ...CHANNEL, sinceTs: JANUARY_START };
    const all = await core.postersPage({ ...q, offset: 0, limit: POSTERS_PAGE_MAX });
    const first = await core.postersPage({ ...q, offset: 0, limit: STATS_TOP });
    const next = await core.postersPage({ ...q, offset: STATS_TOP, limit: STATS_TOP });
    expect([...first, ...next]).toEqual(all);
    expect(all).toHaveLength(MANY_POSTERS + 2);
    expect((await core.activityStats(q)).posters).toEqual(first);
    expect(all.slice(2).map((p) => p.userId)).toEqual([...all.slice(2).map((p) => p.userId)].sort());
    expect(await core.postersPage({ ...q, offset: all.length, limit: STATS_TOP })).toEqual([]);
    expect((await core.postersPage({ ...CHANNEL, sinceTs: MARCH_START, offset: 0, limit: STATS_TOP })).map((p) => p.count)).toEqual([1, 1]);
    expect((await core.postersPage({ scope: 'server', channelId: 'c2', sinceTs: MARCH_START, offset: 0, limit: STATS_TOP })).map((p) => p.userId)).toEqual(['u1', 'u2']);
  });

  it.each([{ offset: -1, limit: 1 }, { offset: 0, limit: 0 }, { offset: 0, limit: POSTERS_PAGE_MAX + 1 }, { offset: 0.5, limit: 1 }])('rejects invalid poster page bounds (%j)', async (bounds) => {
    await expect(analytics().core.postersPage({ ...EVERYTHING, ...bounds })).rejects.toThrow('Poster pages require');
  });
});
