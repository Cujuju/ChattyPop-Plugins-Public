import { describe, expect, it } from 'vitest';
import type { PluginDb } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { attachmentRows } from '../core/feed';
import { attachmentTextMatches } from '../core/textMatches';
import { attachmentMonths } from '../core/months';
import { attachmentPeople, attachmentPlaces, attachmentTotals } from '../core/totals';
import { attachmentBreakdown, attachmentPostings } from '../core/space';
import type { BreakdownBy } from '../shared/types';
import { at, seedMessage, start } from './attachmentsHarness';

const ARCHIVE_ROWS = 1000;
const PAGE_SIZE = 100;
const MID_MONTH_DAYS = 15;

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

describe('message author lookups', () => {
  it('never materialize the archive_messages view, in any read', () => {
    const t = start({ archive: { channels: [{ id: '200000000000000001' }], messages: Array.from({ length: PAGE_SIZE }, (_, n) =>
      seedMessage({ id: String(n), channelId: '200000000000000001', ts: at(n), filename: 'image.png', contentType: 'image/png', size: 100 })) } });
    const plans: string[] = [];
    const db = planDb(t.db, plans);
    const scoped = { channelId: '200000000000000001', authorId: 'alice' };
    attachmentRows(db, { ...scoped, limit: PAGE_SIZE });
    attachmentTotals(db, scoped);
    attachmentPeople(db, { ...scoped, limit: PAGE_SIZE });
    attachmentPlaces(db, scoped);
    attachmentPostings(db, 'a'.repeat(64));
    attachmentRows(db, { ...scoped, repeated: true, limit: PAGE_SIZE });
    for (const by of ['guild', 'channel', 'person', 'kind'] as BreakdownBy[]) attachmentBreakdown(db, { ...scoped, repeated: true }, by);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.join('\n')).not.toMatch(/MATERIALIZE archive_messages/);
    expect(plans.join('\n')).toMatch(/USING (?:COVERING )?INDEX attachments_sha256/);
    expect(plans.join('\n')).not.toMatch(/SCAN posting(?:\s|$)/);
  });
});

describe('finding query plans', () => {
  it('indexes date windows and per-message derived reads without materializing the archive', () => {
    const t = start({ archive: { channels: [{ id: '200000000000000001' }], messages: Array.from({ length: ARCHIVE_ROWS }, (_, n) =>
      seedMessage({ id: String(n), channelId: '200000000000000001', ts: at(n) + MID_MONTH_DAYS * MS_PER_DAY, filename: 'image.png', contentType: 'image/png', size: 100 })) } });
    t.db.prepare(`INSERT INTO derived_texts (message_id, source, ord, text, part)
      SELECT message_id, 'ocr:' || id, 1, 'nebula', 'attachment:' || id FROM attachments`).run();
    const plans: string[] = [];
    const db = planDb(t.db, plans);
    for (const dir of ['asc', 'desc'] as const) {
      const rows = attachmentRows(db, { limit: PAGE_SIZE, sort: { key: 'date', dir }, startMonth: '2026-01', name: 'nebula' });
      expect(rows).toHaveLength(PAGE_SIZE);
      attachmentRows(db, { limit: PAGE_SIZE, sort: { key: 'date', dir }, startAt: { ts: rows[0]!.ts, id: rows[0]!.id }, name: 'nebula' });
      expect(attachmentTextMatches(db, rows, 'nebula').size).toBe(PAGE_SIZE);
    }
    expect(plans.join('\n')).toMatch(/USING (?:COVERING )?INDEX attachments_ts/);
    expect(plans.join('\n')).toMatch(/USING INDEX derived_texts_message/);
    expect(plans.join('\n')).not.toMatch(/MATERIALIZE archive_messages|SCAN (?:d|p)(?:\s|$)/);
    plans.length = 0;
    expect(attachmentMonths(db, { sinceTs: at(0), name: 'nebula' })).toHaveLength(1);
    expect(plans.join('\n')).toMatch(/USING (?:COVERING )?INDEX attachments_ts/);
    expect(plans.join('\n')).not.toMatch(/MATERIALIZE archive_messages|SCAN (?:d|p)(?:\s|$)/);
  });
});
