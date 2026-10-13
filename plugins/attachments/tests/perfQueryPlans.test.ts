import { describe, expect, it } from 'vitest';
import type { PluginDb } from '@plugin-sdk/core';
import { attachmentRows } from '../core/feed';
import { at, seedMessage, start } from './attachmentsHarness';

const ARCHIVE_ROWS = 1000;
const PAGE_SIZE = 100;

/** Captures the executed query's bound arguments and asks SQLite for that exact statement's plan. */
function planDb(db: PluginDb, plans: string[]): PluginDb {
  return new Proxy(db, { get(target, key) {
    if (key !== 'prepare') return Reflect.get(target, key);
    return (sql: string) => new Proxy(db.prepare(sql), { get(statement, method) {
      if (method !== 'all') return Reflect.get(statement, method);
      return (...params: (string | number)[]) => {
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
        plans.push(...plan.map((r) => r.detail));
        return statement.all(...params);
      };
    } });
  } });
}

describe('newest attachment query plan', () => {
  it('walks attachments_ts without a full attachment sort, including keyset cursors', () => {
    const t = start({ archive: { channels: [{ id: '200000000000000001' }], messages: Array.from({ length: ARCHIVE_ROWS }, (_, n) =>
      seedMessage({ id: String(n), channelId: '200000000000000001', ts: at(n), filename: 'image.png', contentType: 'image/png', size: 100 })) } });
    const plans: string[] = [];
    const db = planDb(t.db, plans);
    const first = attachmentRows(db, { limit: PAGE_SIZE });
    const next = attachmentRows(db, { limit: PAGE_SIZE, after: { ts: first.at(-1)!.ts, id: first.at(-1)!.id } });
    attachmentRows(db, { limit: PAGE_SIZE, before: { ts: next[0]!.ts, id: next[0]!.id } });
    const details = plans.join('\n');
    expect(details).toMatch(/USING (?:COVERING )?INDEX attachments_ts/);
    expect(details).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/);
    expect(first).toHaveLength(PAGE_SIZE);
    expect(next).toHaveLength(PAGE_SIZE);
    expect(new Set([...first, ...next].map((i) => i.id)).size).toBe(PAGE_SIZE * 2);
  });
});
