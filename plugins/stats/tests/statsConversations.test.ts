import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { CONVERSATION_GAP_MS } from '../shared/conversations';
import { SCAN_BATCH_SIZE } from '../core/scan';
import { conversationStats } from '../core/conversations';

const CHANNEL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;
const SECOND_RUN = CONVERSATION_GAP_MS + 3;
const person = (authorId: string, authorName: string) => ({ authorId, authorName });
const ALICE = person('a', 'Alice');
const BOB = person('b', 'Bob');
const CAROL = person('c', 'Carol');

function start() {
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages: [
    { channelId: 'c1', ts: 0, content: '', ...ALICE, extra: { author: { id: 'a', username: 'alice', global_name: 'Alice', avatar: 'alice-avatar' } } },
    { channelId: 'c1', ts: 1, content: '', ...BOB },
    { channelId: 'c1', ts: 2, content: '', ...CAROL },
    { channelId: 'c1', ts: SECOND_RUN, content: '', ...ALICE },
    { channelId: 'c1', ts: SECOND_RUN + CONVERSATION_GAP_MS, content: '', ...BOB },
    { channelId: 't1', ts: 0, content: '', ...ALICE },
    { channelId: 't1', ts: 1, content: '', ...ALICE },
    { channelId: 'c2', ts: 0, content: '', ...ALICE },
    { channelId: 'c2', ts: 1, content: '', ...BOB },
    { channelId: 'hidden', ts: 0, content: '', ...ALICE },
    { channelId: 'hidden', ts: 1, content: '', ...BOB },
  ] } });
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}

describe('Analytics conversation runs', () => {
  it('counts each distinct pair once per run, includes attachment-only messages and separates channels and long gaps', async () => {
    const stats = await start().core.conversationStats(CHANNEL);
    expect([stats.messages, stats.conversations, stats.pairedConversations]).toEqual([7, 3, 2]);
    expect(stats.pairs.map((pair) => [pair.first.userId, pair.second.userId, pair.count])).toEqual([['a', 'b', 2], ['a', 'c', 1], ['b', 'c', 1]]);
    expect(stats.people).toEqual([
      { userId: 'a', name: 'Alice', avatar: 'alice-avatar', count: 3 },
      { userId: 'b', name: 'Bob', avatar: null, count: 3 },
      { userId: 'c', name: 'Carol', avatar: null, count: 2 },
    ]);
  });

  it('honors scope, range and privacy and never pairs a person with themselves', async () => {
    const { t, core } = start();
    const ranged = await core.conversationStats({ ...CHANNEL, sinceTs: SECOND_RUN });
    expect([ranged.messages, ranged.conversations, ranged.pairedConversations]).toEqual([2, 1, 1]);
    expect(ranged.pairs.map((pair) => pair.count)).toEqual([1]);
    expect((await core.conversationStats({ ...CHANNEL, channelId: 't1' })).pairs).toEqual([]);
    expect((await core.conversationStats({ ...CHANNEL, scope: 'server' })).pairs[0]!.count).toBe(4);
    t.archive.setPrivacyMode(true);
    const visible = await core.conversationStats({ scope: 'all', channelId: null, sinceTs: null });
    expect([visible.messages, visible.conversations, visible.pairedConversations, visible.pairs[0]!.count]).toEqual([9, 4, 3, 3]);
    const empty = await core.conversationStats({ ...CHANNEL, channelId: null });
    expect([empty.messages, empty.conversations, empty.pairs, empty.people]).toEqual([0, 0, [], []]);
  });

  it('keeps one run across keyset batches, including equal timestamps and out-of-order ingestion', async () => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: Array.from({ length: SCAN_BATCH_SIZE + 1 }, (_, index) => ({
      channelId: 'c1', ts: index % 2, content: '', ...(index % 2 ? BOB : ALICE),
    })) } });
    onTestFinished(() => t.dispose());
    const prepare = vi.spyOn(t.db, 'prepare');
    const stats = await conversationStats(t.db, CHANNEL);
    expect([stats.messages, stats.conversations, stats.pairs[0]!.count]).toEqual([SCAN_BATCH_SIZE + 1, 1, 1]);
    const sql = prepare.mock.calls.map(([query]) => query).filter((query) => query.startsWith('SELECT m.channel_id'));
    expect(sql).toHaveLength(2);
    expect(sql.every((query) => !/\bcontent\b/.test(query))).toBe(true);
  });
});
