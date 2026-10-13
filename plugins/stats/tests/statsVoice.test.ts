import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin, type SeedArchive } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { VOICE_PEOPLE, voiceShare } from '../shared/voice';
import { ALICE } from './statsFixture';

const CHANNEL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;
const at = (day: number) => new Date(2026, 0, day).getTime();
function start(messages: SeedArchive['messages']) {
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages } });
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}

describe('Analytics share of voice', () => {
  it('uses one shared scale, all-message denominators and the Messages buckets including empty days', async () => {
    const { core } = start([
      { channelId: 'c1', ts: at(1), content: '', extra: { author: ALICE } },
      { channelId: 'c1', ts: at(1), content: '', authorId: 'u2', authorName: 'Bob' },
      { channelId: 't1', ts: at(3), content: '', extra: { author: ALICE } },
    ]);
    const voice = await core.voiceStats(CHANNEL);
    expect(voice.buckets).toEqual((await core.activityStats(CHANNEL)).buckets);
    expect(voice.buckets).toEqual([{ start: '2026-01-01', count: 2 }, { start: '2026-01-02', count: 0 }, { start: '2026-01-03', count: 1 }]);
    expect(voice.people.map(({ poster, counts }) => [poster.userId, poster.count, counts])).toEqual([['u1', 2, [1, 0, 1]], ['u2', 1, [1, 0, 0]]]);
    expect(voice.people[0]!.poster.avatar).toBe('alice-avatar');
    expect(voice.maxShare).toBe(1);
    expect(voiceShare(voice.people[1]!.counts[0]!, voice.buckets[0]!.count) / voice.maxShare).toBe(0.5);
    expect(voiceShare(0, 0)).toBe(0);
  });

  it('bounds posters with stable ties and includes unshown posters in the denominator', async () => {
    const { core } = start(Array.from({ length: VOICE_PEOPLE + 1 }, (_, i) => ({ channelId: 'c1', ts: at(1), content: '', authorId: `u${i}` })));
    const stats = await core.voiceStats(CHANNEL);
    expect(stats.people.map(({ poster }) => poster.userId)).toEqual(Array.from({ length: VOICE_PEOPLE }, (_, i) => `u${i}`));
    expect(stats.maxShare).toBe(1 / (VOICE_PEOPLE + 1));
  });

  it('reuses weekly bucket selection, parent threads, server scope, range and privacy', async () => {
    const { t, core } = start([
      { channelId: 'c1', ts: at(1), content: '', authorId: 'a' },
      { channelId: 't1', ts: at(200), content: '', authorId: 'b' },
      { channelId: 'c2', ts: at(200), content: '', authorId: 'c' },
      { channelId: 'hidden', ts: at(200), content: '', authorId: 'private' },
    ]);
    const stats = await core.voiceStats(CHANNEL);
    expect(stats.bucket).toBe('week');
    expect(stats.buckets).toEqual((await core.activityStats(CHANNEL)).buckets);
    expect(stats.buckets.slice(1, -1).every((b) => b.count === 0)).toBe(true);
    expect((await core.voiceStats({ ...CHANNEL, sinceTs: at(199) })).people.map((p) => p.poster.userId)).toEqual(['b']);
    t.archive.setPrivacyMode(true);
    expect((await core.voiceStats({ ...CHANNEL, scope: 'server' })).people.map((p) => p.poster.userId)).toEqual(['a', 'b', 'c']);
  });

  it('returns a complete empty result for missing anchors and empty ranges', async () => {
    const { core } = start([]);
    for (const query of [CHANNEL, { ...CHANNEL, channelId: null }, { ...CHANNEL, sinceTs: at(2) }]) {
      expect(await core.voiceStats(query)).toEqual({ bucket: 'day', buckets: [], people: [], maxShare: 0 });
    }
  });
});
