import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin, type SeedArchive } from '@plugin-sdk/core/testing';
import { snowflakeFromMs } from '@plugin-sdk/shared';
import statsCore from '../core';
import { STATS_TOP, type ActivityQuery } from '../shared/types';

const CHANNEL: ActivityQuery = { scope: 'channel', channelId: 'c1', sinceTs: null };
const A = 'https://one.example/a';
const B = 'https://two.example/b';

function start(messages: SeedArchive['messages']) {
  const t = testPlugin(statsCore, { archive: {
    channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages,
  } });
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}

describe('Analytics repeated links', () => {
  it('counts repeated URLs, distinct people and reposts including self-reposts', async () => {
    const { core } = start([
      { channelId: 'c1', ts: 0, content: `${A} ${B}` },
      { channelId: 'c1', ts: 1, content: A, authorId: 'u2' },
      { channelId: 't1', ts: 2, content: A, authorId: 'u2' },
      { channelId: 'c1', ts: 3, content: B },
      { channelId: 'c1', ts: 4, content: 'https://once.example/c', authorId: 'u3' },
    ]);
    expect(await core.repeatedLinks(CHANNEL)).toEqual({
      urls: [
        { url: A, host: 'one.example', shares: 3, people: 2 },
        { url: B, host: 'two.example', shares: 2, people: 1 },
      ],
      reposts: [{ userId: 'u2', name: 'u2', avatar: null, count: 2 }, { userId: 'u1', name: 'Alice', avatar: null, count: 1 }],
    });
  });

  it('distinguishes two shares by one person from two shares by two people, with stable ties', async () => {
    const { core } = start([
      { channelId: 'c1', ts: 0, content: B, authorId: 'u2' },
      { channelId: 'c1', ts: 1, content: B, authorId: 'u2' },
      { channelId: 'c1', ts: 2, content: A, authorId: 'u2' },
      { channelId: 'c1', ts: 3, content: A, authorId: 'u1' },
    ]);
    expect(await core.repeatedLinks(CHANNEL)).toEqual({
      urls: [
        { url: A, host: 'one.example', shares: 2, people: 2 },
        { url: B, host: 'two.example', shares: 2, people: 1 },
      ],
      reposts: [{ userId: 'u1', name: 'u1', avatar: null, count: 1 }, { userId: 'u2', name: 'u2', avatar: null, count: 1 }],
    });
  });

  it('uses chronological archive order for tied timestamps, regardless of insertion order', async () => {
    const ts = new Date(2026, 0, 1).getTime();
    const { core } = start([
      { id: snowflakeFromMs(ts, 2), channelId: 'c1', ts, content: A, authorId: 'later' },
      { id: snowflakeFromMs(ts, 1), channelId: 'c1', ts, content: A, authorId: 'first' },
    ]);
    expect((await core.repeatedLinks(CHANNEL)).reposts).toEqual([{ userId: 'later', name: 'later', avatar: null, count: 1 }]);
  });

  it('determines the first share inside the visible scope and selected range', async () => {
    const { t, core } = start([
      { channelId: 'hidden', ts: 0, content: A, authorId: 'private' },
      { channelId: 'c2', ts: 1, content: A, authorId: 'u2' },
      { channelId: 'c1', ts: 2, content: A, authorId: 'u1' },
      { channelId: 't1', ts: 3, content: A, authorId: 'u3' },
      { channelId: 'c1', ts: 4, content: A, authorId: 'u3' },
    ]);
    t.archive.setPrivacyMode(true);
    expect((await core.repeatedLinks(CHANNEL)).reposts).toEqual([{ userId: 'u3', name: 'u3', avatar: null, count: 2 }]);
    expect(await core.repeatedLinks({ ...CHANNEL, scope: 'all' })).toEqual({
      urls: [{ url: A, host: 'one.example', shares: 4, people: 3 }],
      reposts: [{ userId: 'u3', name: 'u3', avatar: null, count: 2 }, { userId: 'u1', name: 'u1', avatar: null, count: 1 }],
    });
    expect((await core.repeatedLinks({ ...CHANNEL, scope: 'server' })).urls[0]?.shares).toBe(4);
    expect(await core.repeatedLinks({ ...CHANNEL, sinceTs: 3 })).toEqual({
      urls: [{ url: A, host: 'one.example', shares: 2, people: 1 }], reposts: [{ userId: 'u3', name: 'u3', avatar: null, count: 1 }],
    });
    expect((await core.repeatedLinks({ ...CHANNEL, sinceTs: 4 })).reposts).toEqual([]);
  });

  it('does not classify a first visible share as a repost of a hidden origin', async () => {
    const { t, core } = start([
      { channelId: 'hidden', ts: 0, content: A, authorId: 'private' },
      { channelId: 'c1', ts: 1, content: A },
    ]);
    t.archive.setPrivacyMode(true);
    expect(await core.repeatedLinks({ ...CHANNEL, scope: 'all' })).toEqual({ urls: [], reposts: [] });
    t.archive.setPrivacyMode(false);
    expect((await core.repeatedLinks({ ...CHANNEL, scope: 'all' })).reposts).toEqual([{ userId: 'u1', name: 'Alice', avatar: null, count: 1 }]);
  });

  it('bounds both rankings to ten entries with stable URL and user-id ties', async () => {
    const ids = Array.from({ length: STATS_TOP + 2 }, (_, index) => String(index).padStart(2, '0'));
    const { core } = start(ids.toReversed().flatMap((id) => [
      { channelId: 'c1', ts: 0, content: `https://example.com/${id}`, authorId: 'original' },
      { channelId: 'c1', ts: 1, content: `https://example.com/${id}`, authorId: `u${id}` },
    ]));
    const stats = await core.repeatedLinks(CHANNEL);
    expect(stats.urls.map((url) => url.url)).toEqual(ids.slice(0, STATS_TOP).map((id) => `https://example.com/${id}`));
    expect(stats.reposts.map((person) => person.userId)).toEqual(ids.slice(0, STATS_TOP).map((id) => `u${id}`));
  });

  it('returns empty rankings for empty scopes and scopes without repeated links', async () => {
    const { core } = start([{ channelId: 'c1', ts: 0, content: A }]);
    for (const query of [CHANNEL, { ...CHANNEL, channelId: null }, { ...CHANNEL, sinceTs: 1 }]) {
      expect(await core.repeatedLinks(query)).toEqual({ urls: [], reposts: [] });
    }
    expect(await start([]).core.repeatedLinks(CHANNEL)).toEqual({ urls: [], reposts: [] });
  });
});
