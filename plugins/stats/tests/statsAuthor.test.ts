import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { scopeSql } from '../core/stats';
import type { ActivityQuery } from '../shared/types';

const ALL: ActivityQuery = { scope: 'all', channelId: null, sinceTs: null };
const PERSON = { ...ALL, authorId: 'a' };
function start() {
  const t = testPlugin(statsCore, { archive: {
    guilds: [{ id: 'away', name: 'Away' }],
    channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'away', guildId: 'away' }, { id: 'dm' }, { id: 'hidden', hidden: true }],
    messages: [
      { channelId: 'c1', ts: 0, authorId: 'a', content: 'wonderful apple 😀 https://example.org/a' },
      { channelId: 't1', ts: 1, authorId: 'a', content: 'wonderful apple 😀 https://example.org/a' },
      { channelId: 'c1', ts: 2, authorId: 'b', content: 'terrible banana 😢 https://other.org/b' },
      { channelId: 'c2', ts: 3, authorId: 'b', content: 'terrible banana' },
      { channelId: 'away', ts: 4, authorId: 'b', content: 'away' },
      { channelId: 'dm', ts: 5, authorId: 'b', content: 'direct' },
      { channelId: 'hidden', ts: 6, authorId: 'a', content: 'private secrets 😢 https://private.org/a' },
    ],
  } });
  t.db.prepare('UPDATE channels SET guild_id = NULL WHERE id = ?').run('dm');
  t.archive.setPrivacyMode(true);
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}

describe('Analytics author scope', () => {
  it.each([
    { scope: 'all', channelId: null }, { scope: 'channel', channelId: 'c1' },
    { scope: 'server', channelId: null, guildId: 'away' }, { scope: 'channel', channelId: 'dm' },
    { scope: 'channel', channelId: null }, { scope: 'server', channelId: null, guildId: null },
  ] as const)('binds the author for $scope at $channelId / $guildId', async (choice) => {
    const { t } = start();
    const scope = (await scopeSql(t.read, { ...PERSON, ...choice, sinceTs: 0 }));
    expect(scope.sql).toContain('m.author_id = ?');
    expect(scope.params.at(-1)).toBe('a');
    for (const authorId of [null, undefined]) expect((await scopeSql(t.read, { ...ALL, ...choice, authorId })).sql).not.toContain('m.author_id');
  });

  it('narrows every core section and keeps the hidden channel excluded', async () => {
    const { core } = start();
    const stats = await core.activityStats(PERSON);
    expect(stats.messages).toBe(2);
    expect(stats.channels.map((c) => c.channelId).sort()).toEqual(['c1', 't1']);
    expect(stats.linksByPerson.map((p) => p.userId)).toEqual(['a']);
    expect(stats.timeline.every((m) => m.activePosters === 1)).toBe(true);
    expect([stats.archivedSince, stats.archivedUntil]).toEqual([0, 1]);
    expect((await core.postersPage({ ...PERSON, offset: 0, limit: 10 })).map((p) => p.userId)).toEqual(['a']);
    expect((await core.emojiStats(PERSON)).emoji).toEqual([{ id: null, name: '😀', animated: false, count: 2 }]);
    const words = await core.wordStats(PERSON);
    expect(words.textMessages).toBe(2);
    expect(words.words.some((w) => w.word === 'banana' || w.word === 'secrets')).toBe(false);
    expect((await core.sentimentStats(PERSON)).textMessages).toBe(2);
    expect((await core.repeatedLinks(PERSON)).urls.map((u) => [u.url, u.shares, u.people])).toEqual([['https://example.org/a', 2, 1]]);
    expect((await core.personStreaks(PERSON)).map((p) => p.userId)).toEqual(['a']);
    expect((await core.personHistory(PERSON)).streaks.map((p) => p.userId)).toEqual(['a']);
    expect((await core.voiceStats(PERSON)).people.map((p) => p.poster.userId)).toEqual(['a']);
    expect((await core.peopleStats(PERSON)).person?.poster.userId).toBe('a');
    expect((await core.conversationStats(PERSON)).people.map((p) => p.userId).sort()).toEqual(['a', 'b']);
  });

  it('returns empty results for an unknown author without throwing', async () => {
    const { core } = start();
    const query = { ...PERSON, authorId: 'unknown' };
    expect((await core.activityStats(query)).messages).toBe(0);
    expect(await core.postersPage({ ...query, offset: 0, limit: 10 })).toEqual([]);
    expect((await core.emojiStats(query)).emoji).toEqual([]);
    expect((await core.wordStats(query)).textMessages).toBe(0);
    expect((await core.sentimentStats(query)).textMessages).toBe(0);
    expect((await core.repeatedLinks(query)).urls).toEqual([]);
    expect(await core.personStreaks(query)).toEqual([]);
    expect((await core.personHistory(query)).streaks).toEqual([]);
    expect((await core.voiceStats(query)).people).toEqual([]);
    expect((await core.peopleStats(query)).person).toBeNull();
    expect((await core.conversationStats(query)).conversations).toBe(0);
  });
});
