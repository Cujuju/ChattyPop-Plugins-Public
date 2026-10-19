import { statementRead } from '@chattypop/host-testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin, type SeedArchive } from '@plugin-sdk/core/testing';
import { snowflakeFromMs } from '@shared/discord';
import statsCore from '../core';
import { wordStats } from '../core/words';
import { MESSAGE_WORD_BUCKETS, WORDS_PERSON_MIN_MESSAGES } from '../shared/messageLength';
import { STATS_TOP, type ActivityQuery } from '../shared/types';

const CHANNEL: ActivityQuery = { scope: 'channel', channelId: 'c1', sinceTs: null };
const prose = (words: number): string => Array.from({ length: words }, () => 'word').join(' ');

function start(messages: SeedArchive['messages']) {
  const t = testPlugin(statsCore, { archive: {
    channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages,
  } });
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}

describe('Analytics message length', () => {
  it('gets average, median, all bucket boundaries and longest messages from one words scan', async () => {
    const lengths = [1, 2, 5, 6, 20, 21, 50, 51];
    const { t } = start(lengths.map((words, index) => ({ id: snowflakeFromMs(index), channelId: 'c1', ts: index, content: prose(words) })));
    const prepare = vi.spyOn(t.db, 'prepare');
    onTestFinished(() => prepare.mockRestore());
    const stats = await wordStats(statementRead(t.db), CHANNEL);
    expect(stats.wordsPerMessage).toBe(19.5);
    expect(stats.length.medianWords).toBe(13);
    expect(stats.length.distribution).toEqual(MESSAGE_WORD_BUCKETS.map(({ id }, index) => ({ id, count: index === 0 || index === 4 ? 1 : 2 })));
    expect(stats.length.longest.map((m) => [m.messageId, m.words, m.userId, m.channelId, m.ts])).toEqual(
      lengths.map((words, index) => [snowflakeFromMs(index), words, 'u1', 'c1', index]).reverse(),
    );
  });

  it('keeps zero-token retained text in the average and even median, while excluding empty content', async () => {
    const { core } = start([
      { channelId: 'c1', ts: 0, content: '😀 https://example.com' },
      { channelId: 'c1', ts: 1, content: prose(3) },
      { channelId: 'c1', ts: 2, content: ' \t\n' },
    ]);
    const stats = await core.wordStats(CHANNEL);
    expect([stats.textMessages, stats.wordsPerMessage, stats.length.medianWords, stats.length.zeroWordMessages]).toEqual([2, 1.5, 1.5, 1]);
    expect(stats.length.distribution.reduce((n, bucket) => n + bucket.count, 0)).toBe(1);
  });

  it('enforces the inclusive minimum sample and stable per-person averages', async () => {
    const { core } = start([
      ...Array.from({ length: WORDS_PERSON_MIN_MESSAGES }, (_, ts) => ({ channelId: 'c1', ts, authorId: 'u2', content: prose(2) })),
      ...Array.from({ length: WORDS_PERSON_MIN_MESSAGES }, (_, ts) => ({ channelId: 't1', ts, authorId: 'u1', content: prose(2) })),
      ...Array.from({ length: WORDS_PERSON_MIN_MESSAGES - 1 }, (_, ts) => ({ channelId: 'c1', ts, authorId: 'small', content: prose(50) })),
    ]);
    expect((await core.wordStats(CHANNEL)).length.people).toEqual([
      { userId: 'u1', name: 'u1', avatar: null, textMessages: WORDS_PERSON_MIN_MESSAGES, averageWords: 2 },
      { userId: 'u2', name: 'u2', avatar: null, textMessages: WORDS_PERSON_MIN_MESSAGES, averageWords: 2 },
    ]);
    expect((await core.wordStats({ ...CHANNEL, sinceTs: 1 })).length.people).toEqual([]);
  });

  it('bounds both rankings and breaks longest-message ties by date then id', async () => {
    const { core } = start(Array.from({ length: STATS_TOP + 2 }, (_, person) =>
      Array.from({ length: WORDS_PERSON_MIN_MESSAGES }, (_, ts) => ({
        channelId: 'c1', ts, authorId: `u${person}`, content: prose(person + 1),
      }))).flat());
    const stats = (await core.wordStats(CHANNEL)).length;
    expect(stats.people).toHaveLength(STATS_TOP);
    expect(stats.people.map((p) => p.averageWords)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(stats.longest).toHaveLength(STATS_TOP);
    expect(stats.longest.map((m) => m.ts)).toEqual(Array.from({ length: STATS_TOP }, (_, ts) => ts));
    const tied = start([
      { id: snowflakeFromMs(0, 2), channelId: 'c1', ts: 0, content: 'word' },
      { id: snowflakeFromMs(0, 1), channelId: 'c1', ts: 0, content: 'word' },
    ]);
    expect((await tied.core.wordStats(CHANNEL)).length.longest.map((m) => m.messageId))
      .toEqual([snowflakeFromMs(0, 2), snowflakeFromMs(0, 1)].sort());
  });

  it('uses visible scope and range for every length result', async () => {
    const { t, core } = start([
      { id: snowflakeFromMs(3, 1), channelId: 'hidden', ts: 3, authorId: 'private', content: prose(100) },
      { id: snowflakeFromMs(3, 2), channelId: 'c2', ts: 3, content: prose(50) },
      { id: snowflakeFromMs(1), channelId: 'c1', ts: 1, content: prose(2) },
      { id: snowflakeFromMs(2), channelId: 't1', ts: 2, content: prose(3) },
    ]);
    t.archive.setPrivacyMode(true);
    expect((await core.wordStats(CHANNEL)).length.longest.map((m) => m.messageId)).toEqual([snowflakeFromMs(2), snowflakeFromMs(1)]);
    expect((await core.wordStats({ ...CHANNEL, sinceTs: 2 })).length.medianWords).toBe(3);
    expect((await core.wordStats({ ...CHANNEL, scope: 'all' })).length.longest.map((m) => m.messageId))
      .toEqual([snowflakeFromMs(3, 2), snowflakeFromMs(2), snowflakeFromMs(1)]);
    expect((await core.wordStats({ ...CHANNEL, scope: 'server' })).length.longest).toHaveLength(3);
  });

  it('returns all empty length fields for empty scopes', async () => {
    const { core } = start([]);
    for (const query of [CHANNEL, { ...CHANNEL, channelId: null }]) {
      expect((await core.wordStats(query)).length).toEqual({
        medianWords: 0, zeroWordMessages: 0,
        distribution: MESSAGE_WORD_BUCKETS.map(({ id }) => ({ id, count: 0 })), longest: [], people: [],
      });
    }
  });
});
