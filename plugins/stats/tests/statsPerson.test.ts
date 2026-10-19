import { analyticsClient } from './analyticsClient';
import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin, type SeedArchive } from '@plugin-sdk/core/testing';
import { MS_PER_MIN } from '@plugin-sdk/shared';
import statsCore from '../core';
import { CONVERSATION_GAP_MS } from '../shared/conversations';
import { QUIET_MIN_MESSAGES } from '../shared/personHistory';
import { STATS_TOP } from '../shared/types';

const CHANNEL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;
const RUN_STEP = CONVERSATION_GAP_MS * 3; // Separate fixture runs stay beyond the conversation gap.
const at = (day: number) => new Date(2026, 0, day).getTime();
const messages = (authorId: string, day: number, count = 1) => Array.from({ length: count }, (_, i) => ({ channelId: 'c1', ts: at(day) + i, authorId, content: '' }));
function start(items: SeedArchive['messages']) {
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: items } });
  onTestFinished(() => t.dispose());
  return analyticsClient(t);
}

describe('Analytics person comparisons', () => {
  it('forms runs from everyone, reports only involved runs/pairs and retains scope medians', async () => {
    const core = start([
      { channelId: 'c1', ts: 0, authorId: 'a', content: '' },
      { channelId: 'c1', ts: MS_PER_MIN, authorId: 'b', content: '' },
      { channelId: 'c1', ts: MS_PER_MIN * 2, authorId: 'a', content: '' },
      { channelId: 'c1', ts: RUN_STEP, authorId: 'a', content: '' },
      { channelId: 'c1', ts: RUN_STEP + MS_PER_MIN * 3, authorId: 'b', content: '' },
      { channelId: 'c1', ts: RUN_STEP * 2, authorId: 'b', content: '' },
      { channelId: 'c1', ts: RUN_STEP * 2 + MS_PER_MIN * 5, authorId: 'c', content: '' },
      { channelId: 'c1', ts: RUN_STEP * 3, authorId: 'a', content: '' },
    ]);
    const everyone = await core.conversationStats(CHANNEL);
    const person = await core.conversationStats({ ...CHANNEL, authorId: 'a' });
    expect([person.messages, person.conversations, person.pairedConversations]).toEqual([4, 3, 2]);
    expect(person.pairs.map((p) => [p.first.userId, p.second.userId, p.exchanges])).toEqual([['a', 'b', 3]]);
    expect(person.people.map((p) => p.userId).sort()).toEqual(['a', 'b']);
    expect(person.roles.person).toEqual({ starts: 2, closes: 1, replyCount: 2, medianReplyMs: MS_PER_MIN * 2, scopeMedianStarts: 1, scopeMedianCloses: 1 });
    expect(person.roles.medianReplyMs).toBe(everyone.roles.medianReplyMs);
    expect(person.roles.medianReplyMs).toBe(MS_PER_MIN * 3);
    expect([person.roles.starts, person.roles.closes, person.roles.fastest]).toEqual([[], [], []]);
    const replyOnly = await core.conversationStats({ ...CHANNEL, authorId: 'c' });
    expect(replyOnly.roles.person).toMatchObject({ starts: 0, closes: 1, replyCount: 0, medianReplyMs: null });
  });

  it('does not invent exchanges by removing intervening authors or truncate a person below the top ten roles', async () => {
    const core = start([
      ...Array.from({ length: STATS_TOP + 1 }, (_, i) => [
        { channelId: 'c1', ts: RUN_STEP * i, authorId: `u${i}`, content: '' },
        { channelId: 'c1', ts: RUN_STEP * i + 1, authorId: 'reply', content: '' },
      ]).flat(),
      { channelId: 'c1', ts: RUN_STEP * (STATS_TOP + 2), authorId: 'z', content: '' },
      { channelId: 'c1', ts: RUN_STEP * (STATS_TOP + 2) + 1, authorId: 'middle', content: '' },
      { channelId: 'c1', ts: RUN_STEP * (STATS_TOP + 2) + 2, authorId: 'last', content: '' },
    ]);
    const person = await core.conversationStats({ ...CHANNEL, authorId: 'z' });
    expect(person.pairs.map((p) => [p.first.userId, p.second.userId])).toEqual([['middle', 'z']]);
    expect(person.roles.person).toMatchObject({ starts: 1, closes: 0, replyCount: 1, medianReplyMs: 1 });
  });

  it('uses scope-wide bucket boundaries and denominators, even for a person below the voice ranking', async () => {
    const core = start([...messages('leader', 1, 10), ...messages('a', 2, 2), ...messages('b', 2, 6), ...messages('leader', 3, 10)]);
    const everyone = await core.voiceStats(CHANNEL);
    const person = await core.voiceStats({ ...CHANNEL, authorId: 'a' });
    expect(person.buckets).toEqual(everyone.buckets);
    expect(person.people.map((p) => [p.poster.userId, p.counts])).toEqual([['a', [0, 2, 0]]]);
    expect(person.maxShare).toBe(2 / 8);
    expect(person).toEqual((await core.peopleStats({ ...CHANNEL, authorId: 'a' })).voice);
  });

  it('ranks among everyone in the exact range, sharing ranks on ties', async () => {
    const core = start([...messages('old', 1, 10), ...messages('leader', 2, 3), ...messages('a', 2, 2), ...messages('b', 2, 2), ...messages('last', 2)]);
    for (const authorId of ['a', 'b']) {
      const stats = await core.peopleStats({ ...CHANNEL, sinceTs: at(2), authorId });
      expect(stats.person).toMatchObject({ poster: { userId: authorId, count: 2 }, rank: 2 });
      expect(stats.history.streaks.map((p) => p.userId)).toEqual([authorId]);
    }
    expect((await core.peopleStats({ ...CHANNEL, sinceTs: at(2) + 1, authorId: 'leader' })).person).toMatchObject({ poster: { count: 2 }, rank: 1 });
  });

  it('retains scope-wide history anchors and reports the selected person before ranking limits', async () => {
    const ids = Array.from({ length: STATS_TOP + 1 }, (_, i) => `quiet${i}`);
    const core = start([
      ...ids.flatMap((id) => messages(id, 1, QUIET_MIN_MESSAGES + 1)), ...messages('z', 1, QUIET_MIN_MESSAGES),
      ...messages('returner', 1), ...messages('returner', 60), ...messages('returner', 61), ...messages('anchor', 90),
    ]);
    const quiet = await core.peopleStats({ ...CHANNEL, sinceTs: at(80), authorId: 'z' });
    expect(quiet.history.quiet.map((p) => [p.userId, p.count, p.lastSeen])).toEqual([['z', QUIET_MIN_MESSAGES, '2026-01-01']]);
    expect(quiet.history.lastDay).toBe('2026-03-31');
    expect(quiet.history.returned).toEqual([]);
    const returned = await core.peopleStats({ ...CHANNEL, authorId: 'returner' });
    expect(returned.history.returned.map((p) => [p.userId, p.silenceDays, p.returned])).toEqual([['returner', 58, '2026-03-01']]);
    expect(returned.history.streaks).toEqual([{ userId: 'returner', name: 'returner', avatar: null, days: 2, start: '2026-03-01', end: '2026-03-02' }]);
  });

  it('keeps timeline archive bounds whole-scope while narrowing streaks to the selected range', async () => {
    const core = start([...messages('a', 1), ...messages('a', 2), ...messages('a', 60), ...messages('b', 90)]);
    const stats = await core.activityStats({ ...CHANNEL, authorId: 'a', sinceTs: at(60) });
    expect([stats.archivedSince, stats.archivedUntil]).toEqual([at(1), at(60)]);
    expect(stats.streaks.longest?.days).toBe(1);
  });
});
