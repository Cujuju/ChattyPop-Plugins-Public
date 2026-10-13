import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { activityStats } from '../core/stats';
import { wordStats } from '../core/words';
import { conversationStats } from '../core/conversations';
import { peopleStats } from '../core/personHistory';
import { SCAN_BATCH_SIZE } from '../core/scan';

const ALL = { scope: 'all', channelId: null, sinceTs: null } as const;
function fixture(count: number) {
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: Array.from({ length: count }, (_, i) => ({
    channelId: 'c1', ts: i, content: 'pizza', authorId: i % 2 ? 'a' : 'b',
  })) } });
  onTestFinished(() => t.dispose());
  const prepare = t.db.prepare.bind(t.db);
  const reads: string[] = [];
  const spy = vi.spyOn(t.db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    const get = statement.get.bind(statement);
    const all = statement.all.bind(statement);
    statement.get = (...params) => { reads.push(sql); return get(...params); };
    statement.all = (...params) => { reads.push(sql); return all(...params); };
    return statement;
  });
  onTestFinished(() => spy.mockRestore());
  return { db: t.db, reads };
}

describe('Analytics section SQL reads', () => {
  it.each([
    { count: 2, wordReads: 3, conversationReads: 3, batches: 1 },
    { count: SCAN_BATCH_SIZE + 1, wordReads: 4, conversationReads: 4, batches: 2 },
    { count: 0, wordReads: 2, conversationReads: 1, batches: 0 },
  ])('keeps one Words scan, one Conversations scan and one shared People read ($count messages)', async ({ count, wordReads, conversationReads, batches }) => {
    const { db, reads } = fixture(count);
    await wordStats(db, ALL);
    expect(reads).toHaveLength(wordReads);
    expect(reads.filter((sql) => sql.startsWith('SELECT m.id, m.content'))).toHaveLength(batches);
    reads.length = 0;
    await conversationStats(db, ALL);
    expect(reads).toHaveLength(conversationReads);
    expect(reads.every((sql) => !/\bcontent\b/.test(sql))).toBe(true);
    expect(reads.filter((sql) => sql.startsWith('SELECT m.channel_id'))).toHaveLength(batches);
    reads.length = 0;
    peopleStats(db, ALL);
    expect(reads).toHaveLength(1);
    expect(reads[0]).not.toMatch(/\bcontent\b/);
  });

  it('leaves the common all-time aggregate at thirteen reads with no added section scans', () => {
    const { db, reads } = fixture(2);
    activityStats(db, ALL);
    expect(reads).toHaveLength(13);
    expect(reads.every((sql) => !/SELECT m.id, m.content|SELECT m.channel_id, m.ts|AS rangeCount/.test(sql))).toBe(true);
  });
});
