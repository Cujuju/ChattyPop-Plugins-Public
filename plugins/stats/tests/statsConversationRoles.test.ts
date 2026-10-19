import { statementRead } from '@chattypop/host-testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin, type SeedArchive } from '@plugin-sdk/core/testing';
import { MS_PER_S, MS_PER_MIN, MS_PER_HOUR } from '@plugin-sdk/shared';
import statsCore from '../core';
import { conversationStats } from '../core/conversations';
import { CONVERSATION_GAP_MS, REPLY_MIN_RUNS } from '../shared/conversations';
import { STATS_TOP } from '../shared/types';
import { formatReplyDelay } from '../renderer/replyDelay';

const CHANNEL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;
const RUN_STEP = CONVERSATION_GAP_MS * 3;
function start(messages: SeedArchive['messages']) {
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages } });
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}
const run = (opener: string, reply: number, index: number, channelId = 'c1') => [
  { channelId, ts: index * RUN_STEP, content: '', authorId: opener },
  { channelId, ts: index * RUN_STEP + reply, content: '', authorId: 'reply' },
  { channelId, ts: index * RUN_STEP + reply + 1, content: '', authorId: opener },
];

describe('Analytics conversation roles', () => {
  it('excludes solo runs, counts closings by the opener and averages the middle two reply times', async () => {
    const { t } = start([
      { channelId: 't1', ts: 0, content: '', authorId: 'solo' },
      ...run('a', MS_PER_MIN, 0), ...run('b', 3 * MS_PER_MIN, 1),
    ]);
    const prepare = vi.spyOn(t.db, 'prepare');
    const roles = (await conversationStats(statementRead(t.db), CHANNEL)).roles;
    expect(roles.starts.map((p) => [p.userId, p.count])).toEqual([['a', 1], ['b', 1]]);
    expect(roles.closes.map((p) => [p.userId, p.count])).toEqual([['a', 1], ['b', 1]]);
    expect(roles.medianReplyMs).toBe(2 * MS_PER_MIN);
    expect(roles.fastest).toEqual([]);
  });

  it('measures from the first message, even when the opener posts again before the reply', async () => {
    const { core } = start([
      { channelId: 'c1', ts: 0, content: '', authorId: 'a' },
      { channelId: 'c1', ts: MS_PER_MIN, content: '', authorId: 'a' },
      { channelId: 'c1', ts: 2 * MS_PER_MIN, content: '', authorId: 'b' },
      { channelId: 'c1', ts: 3 * MS_PER_MIN, content: '', authorId: 'c' },
    ]);
    const roles = (await core.conversationStats(CHANNEL)).roles;
    expect(roles.medianReplyMs).toBe(2 * MS_PER_MIN);
    expect(roles.closes.map((p) => p.userId)).toEqual(['c']);
  });

  it('applies the minimum inclusively, uses per-person even medians and orders equal medians by user id', async () => {
    const count = REPLY_MIN_RUNS + 1;
    const { core } = start([
      ...Array.from({ length: count }, (_, i) => run('b', (i + 1) * MS_PER_S, i)).flat(),
      ...Array.from({ length: count }, (_, i) => run('a', (i + 1) * MS_PER_S, count + i)).flat(),
      ...Array.from({ length: REPLY_MIN_RUNS }, (_, i) => run('minimum', 3 * MS_PER_S, count * 2 + i)).flat(),
      ...Array.from({ length: REPLY_MIN_RUNS - 1 }, (_, i) => run('below', 0, count * 3 + i)).flat(),
    ]);
    const roles = (await core.conversationStats(CHANNEL)).roles;
    expect(roles.fastest.map((p) => [p.userId, p.count, p.medianReplyMs])).toEqual([
      ['a', count, 2.5 * MS_PER_S], ['b', count, 2.5 * MS_PER_S], ['minimum', REPLY_MIN_RUNS, 3 * MS_PER_S],
    ]);
  });

  it('honors scopes, hidden channels, range and empty results', async () => {
    const { t, core } = start([...run('a', MS_PER_S, 0, 't1'), ...run('other', 0, 1, 'c2'), ...run('private', 0, 2, 'hidden')]);
    expect((await core.conversationStats(CHANNEL)).roles.starts.map((p) => p.userId)).toEqual(['a']);
    t.archive.setPrivacyMode(true);
    expect((await core.conversationStats({ ...CHANNEL, scope: 'server' })).roles.starts.map((p) => p.userId)).toEqual(['a', 'other']);
    for (const query of [{ ...CHANNEL, channelId: null }, { ...CHANNEL, sinceTs: MS_PER_S + 1 }]) {
      expect((await core.conversationStats(query)).roles).toEqual({ starts: [], closes: [], fastest: [], medianReplyMs: null });
    }
    expect((await start([]).core.conversationStats(CHANNEL)).roles.medianReplyMs).toBeNull();
  });

  it('bounds role rankings with stable ties', async () => {
    const { core } = start(Array.from({ length: STATS_TOP + 1 }, (_, i) => run(`u${String(i).padStart(2, '0')}`, 0, i)).flat());
    const roles = (await core.conversationStats(CHANNEL)).roles;
    expect(roles.starts.map((p) => p.userId)).toEqual(Array.from({ length: STATS_TOP }, (_, i) => `u${String(i).padStart(2, '0')}`));
    expect(roles.closes.map((p) => p.userId)).toEqual(roles.starts.map((p) => p.userId));
    expect(roles.medianReplyMs).toBe(0);
  });

  it('formats durations in the largest sensible seconds, minutes or hours unit', () => {
    expect(formatReplyDelay(0)).toMatch(/0 seconds/);
    expect(formatReplyDelay(1.5 * MS_PER_S)).toMatch(/1[.,]5 seconds/);
    expect(formatReplyDelay(2 * MS_PER_MIN)).toMatch(/2 minutes/);
    expect(formatReplyDelay(1.5 * MS_PER_HOUR)).toMatch(/1[.,]5 hours/);
  });
});
