// The Activity plugin's counts, as a desktop window asks its core side for them over a seeded archive.
import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_DAY } from '@shared/units';
import statsCore from '../core';
import type { ActivityQuery } from '../shared/types';

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

  it('folds link shares by host name, dropping www.', async () => {
    expect((await start().stats({ scope: 'all', channelId: null, sinceTs: null })).domains).toEqual([
      { domain: 'youtube.com', count: 2 },
      { domain: 'x.com', count: 1 },
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
