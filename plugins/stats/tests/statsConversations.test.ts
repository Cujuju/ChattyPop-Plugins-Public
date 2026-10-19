import { statementRead } from '@chattypop/host-testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { DEFAULT_GUILD, testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { CONVERSATION_GAP_MS, CONVERSATION_PAIRS } from '../shared/conversations';
import { SCAN_BATCH_SIZE } from '../core/scanQueue';
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
  it('counts adjacent exchanges, includes attachment-only messages and preserves run totals', async () => {
    const stats = await start().core.conversationStats(CHANNEL);
    expect([stats.messages, stats.conversations, stats.pairedConversations]).toEqual([7, 3, 2]);
    expect(stats.pairs.map((pair) => [pair.first.userId, pair.second.userId, pair.exchanges])).toEqual([['a', 'b', 2], ['b', 'c', 1]]);
    expect(stats.people).toEqual([
      { userId: 'b', name: 'Bob', avatar: null, exchanges: 3 },
      { userId: 'a', name: 'Alice', avatar: 'alice-avatar', exchanges: 2 },
      { userId: 'c', name: 'Carol', avatar: null, exchanges: 1 },
    ]);
  });

  it('honors scope, range and privacy and never pairs a person with themselves', async () => {
    const { t, core } = start();
    const ranged = await core.conversationStats({ ...CHANNEL, sinceTs: SECOND_RUN });
    expect([ranged.messages, ranged.conversations, ranged.pairedConversations]).toEqual([2, 1, 1]);
    expect(ranged.pairs.map((pair) => pair.exchanges)).toEqual([1]);
    expect((await core.conversationStats({ ...CHANNEL, channelId: 't1' })).pairs).toEqual([]);
    expect((await core.conversationStats({ ...CHANNEL, scope: 'server', guildId: DEFAULT_GUILD.id })).pairs[0]!.exchanges).toBe(4);
    t.archive.setPrivacyMode(true);
    const visible = await core.conversationStats({ scope: 'all', channelId: null, sinceTs: null });
    expect([visible.messages, visible.conversations, visible.pairedConversations, visible.pairs[0]!.exchanges]).toEqual([9, 4, 3, 3]);
    const empty = await core.conversationStats({ ...CHANNEL, channelId: null });
    expect([empty.messages, empty.conversations, empty.pairs, empty.people]).toEqual([0, 0, [], []]);
  });

  it('keeps one run across keyset batches, including equal timestamps and out-of-order ingestion', async () => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: Array.from({ length: SCAN_BATCH_SIZE + 1 }, (_, index) => ({
      channelId: 'c1', ts: index % 2, content: '', ...(index % 2 ? BOB : ALICE),
    })) } });
    onTestFinished(() => t.dispose());
    const prepare = vi.spyOn(t.db, 'prepare');
    const stats = await conversationStats(statementRead(t.db), CHANNEL);
    expect([stats.messages, stats.conversations, stats.pairs[0]!.exchanges]).toEqual([SCAN_BATCH_SIZE + 1, 1, 1]);
    const sql = prepare.mock.calls.map(([query]) => query).filter((query) => query.startsWith('SELECT m.channel_id'));
    expect(sql.every((query) => !/\bcontent\b/.test(query))).toBe(true);
  });

  it.each([
    { name: 'A, B, A, B', authors: [ALICE, BOB, ALICE, BOB], pairs: [['a', 'b', 3]], people: [['a', 3], ['b', 3]], paired: 1 },
    { name: 'A, A, B', authors: [ALICE, ALICE, BOB], pairs: [['a', 'b', 1]], people: [['a', 1], ['b', 1]], paired: 1 },
    { name: 'A, B, C, A', authors: [ALICE, BOB, CAROL, ALICE], pairs: [['a', 'b', 1], ['a', 'c', 1], ['b', 'c', 1]], people: [['a', 2], ['b', 2], ['c', 2]], paired: 1 },
    { name: 'A alone', authors: [ALICE], pairs: [], people: [], paired: 0 },
    { name: 'A, A', authors: [ALICE, ALICE], pairs: [], people: [], paired: 0 },
  ])('counts turn-taking for $name', async ({ authors, pairs, people, paired }) => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: authors.map((author, ts) => ({
      channelId: 'c1', ts, content: '', ...author,
    })) } });
    onTestFinished(() => t.dispose());
    const stats = await t.client('renderer').conversationStats(CHANNEL);
    expect([stats.messages, stats.conversations, stats.pairedConversations]).toEqual([authors.length, 1, paired]);
    expect(stats.pairs.map((pair) => [pair.first.userId, pair.second.userId, pair.exchanges])).toEqual(pairs);
    expect(stats.people.map((person) => [person.userId, person.exchanges])).toEqual(people);
  });

  it.each([
    { gap: CONVERSATION_GAP_MS, runs: 1, paired: 1, exchanges: [1] },
    { gap: CONVERSATION_GAP_MS + 1, runs: 2, paired: 0, exchanges: [] },
  ])('counts exchanges only through the inclusive gap ($gap ms)', async ({ gap, runs, paired, exchanges }) => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: [
      { channelId: 'c1', ts: 0, content: '', ...ALICE },
      { channelId: 'c1', ts: gap, content: '', ...BOB },
    ] } });
    onTestFinished(() => t.dispose());
    const stats = await t.client('renderer').conversationStats(CHANNEL);
    expect([stats.conversations, stats.pairedConversations]).toEqual([runs, paired]);
    expect(stats.pairs.map((pair) => pair.exchanges)).toEqual(exchanges);
  });

  it('breaks adjacency between channels even without a lull', async () => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 'c2' }], messages: [
      { channelId: 'c1', ts: 0, content: '', ...ALICE },
      { channelId: 'c2', ts: 1, content: '', ...BOB },
    ] } });
    onTestFinished(() => t.dispose());
    const stats = await t.client('renderer').conversationStats({ scope: 'all', channelId: null, sinceTs: null });
    expect([stats.conversations, stats.pairedConversations, stats.pairs, stats.people]).toEqual([2, 0, [], []]);
  });

  it('keeps exchanges across keyset batches with equal timestamps', async () => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: Array.from({ length: SCAN_BATCH_SIZE + 1 }, (_, index) => ({
      channelId: 'c1', ts: 0, content: '', ...(index % 2 ? BOB : ALICE),
    })) } });
    onTestFinished(() => t.dispose());
    const stats = await t.client('renderer').conversationStats(CHANNEL);
    expect([stats.conversations, stats.pairedConversations, stats.pairs[0]!.exchanges]).toEqual([1, 1, SCAN_BATCH_SIZE]);
    expect(stats.people.map((person) => person.exchanges)).toEqual([SCAN_BATCH_SIZE, SCAN_BATCH_SIZE]);
  });

  it('keeps each person\'s total exchanges before truncating the pair ranking', async () => {
    const partnerCount = CONVERSATION_PAIRS + 1;
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: Array.from({ length: partnerCount }, (_, index) => [
      { channelId: 'c1', ts: index * 2, content: '', ...ALICE },
      { channelId: 'c1', ts: index * 2 + 1, content: '', ...person(`partner-${index}`, `Partner ${index}`) },
    ]).flat() } });
    onTestFinished(() => t.dispose());
    const stats = await t.client('renderer').conversationStats(CHANNEL);
    expect(stats.pairs).toHaveLength(CONVERSATION_PAIRS);
    expect(stats.people[0]!.exchanges).toBe(partnerCount * 2 - 1);
    expect(stats.pairs.every((pair) => pair.exchanges === 2)).toBe(true);
  });
});
