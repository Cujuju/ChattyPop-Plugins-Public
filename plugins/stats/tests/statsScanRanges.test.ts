import { statementRead } from '@chattypop/host-testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { SCAN_BATCH_SIZE, scanText } from '../core/scan';
import { conversationMessages } from '../core/conversationScan';
import { emojiStats } from '../core/emoji';

const CHANNEL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;

describe('Analytics bounded channel/time pages', () => {
  it.each([false, true].flatMap((equal) => [null, 'author'].map((authorId) => ({ equal, authorId }))))('seeks bounded ranges without sorting (equal: $equal, author: $authorId)', async ({ equal, authorId }) => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages:
      Array.from({ length: SCAN_BATCH_SIZE * 2 + 1 }, (_, index) => ({
        channelId: 'c1', ts: equal ? 0 : SCAN_BATCH_SIZE * 2 - index, content: 'word', authorId: 'author',
      })) } });
    onTestFinished(() => t.dispose());
    const prepare = t.db.prepare.bind(t.db);
    const plans: string[] = [];
    const spy = vi.spyOn(t.db, 'prepare').mockImplementation(((sql: string) => {
      const stmt = prepare(sql);
      if (sql.startsWith('SELECT m.id, m.content')) {
        const all = stmt.all;
        stmt.all = (...args: unknown[]) => {
          plans.push(...(prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((row) => row.detail));
          return all(...args);
        };
      }
      return stmt;
    }) as typeof t.db.prepare);
    try {
      const seen: number[] = [];
      const total = await scanText(statementRead(t.db), { ...CHANNEL, authorId }, (message) => seen.push(message.seq));
      expect(total).toBe(SCAN_BATCH_SIZE * 2 + 1);
      expect(new Set(seen).size).toBe(total);
      expect(plans.join('\n')).toMatch(/messages_channel_ts \(channel_id=\? AND ts=\? AND rowid>\? AND rowid<\?\)/);
      expect(plans.join('\n')).toMatch(/messages_channel_ts \(channel_id=\? AND ts>\?\)/);
      expect(plans.join('\n')).not.toMatch(/TEMP B-TREE/);
    } finally { spy.mockRestore(); }
  });

  it('rechecks privacy and scope on later pages and excludes arrivals in an unread thread', async () => {
    const t = testPlugin(statsCore, { archive: {
      channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1', hidden: true }, { id: 'outside' }],
      messages: [
        ...Array.from({ length: SCAN_BATCH_SIZE + 1 }, (_, ts) => ({ channelId: 'c1', ts, content: 'visible' })),
        { channelId: 't1', ts: -1, content: 'hidden thread' },
        { channelId: 'outside', ts: -1, content: 'other scope' },
      ],
    } });
    onTestFinished(() => t.dispose());
    let count = 0;
    const seen: string[] = [];
    await scanText(statementRead(t.db), CHANNEL, ({ content }) => {
      seen.push(content);
      if (++count === SCAN_BATCH_SIZE) setImmediate(() => {
        t.archive.arrive([{ channelId: 't1', ts: -2, content: 'new arrival' }]);
        t.archive.setPrivacyMode(true);
        t.archive.setChannel('c1', { hidden: true });
      });
    });
    expect(seen).toEqual(Array(SCAN_BATCH_SIZE).fill('visible'));
  });

  it('keeps conversation order and yields before the next batch', async () => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }], messages: [
      { channelId: 't1', ts: -1, content: '' },
      ...Array.from({ length: SCAN_BATCH_SIZE + 1 }, (_, index) => ({ channelId: 'c1', ts: index % 2, content: '' })),
    ] } });
    onTestFinished(() => t.dispose());
    const messages = [];
    let yielded = false;
    for await (const message of (await conversationMessages(statementRead(t.db), CHANNEL))) {
      messages.push(message);
      if (messages.length === SCAN_BATCH_SIZE) setImmediate(() => { yielded = true; });
      if (messages.length === SCAN_BATCH_SIZE + 1) expect(yielded).toBe(true);
    }
    expect(messages).toEqual([...messages].sort((a, b) => a.channel_id.localeCompare(b.channel_id) || a.ts - b.ts || a.seq - b.seq));
    expect(messages).toHaveLength(SCAN_BATCH_SIZE + 2);
  });

  it('preserves first-ingested custom emoji metadata when history arrives out of order', async () => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }], messages: [
      { channelId: 't1', ts: 10, content: '<a:NewestName:123>' },
      { channelId: 'c1', ts: 0, content: '<:OldName:123> <:AnotherName:123>' },
    ] } });
    onTestFinished(() => t.dispose());
    expect((await emojiStats(statementRead(t.db), CHANNEL)).emoji).toEqual([{ id: '123', name: 'NewestName', animated: true, count: 3 }]);
  });
});
