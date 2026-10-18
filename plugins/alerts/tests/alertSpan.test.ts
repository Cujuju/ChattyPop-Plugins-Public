// The Alerts panel's time window: the inbox, its unread counts and mark-all-read keep to the span; the phone's span is checked.
import { beforeEach, describe, expect, it } from 'vitest';
import { archivePayloads } from '@core/plugins/archivePayloads';
import type { Db } from '@core/db';
import { tempDb } from '@chattypop/host-testing';
import { seedArchiveViews } from '@chattypop/host-testing/archiveViewsFixture';
import { adoptAlerts } from './alertsHarness';
import { decodeMarkRead, decodeUnread } from '../shared';
import { ALERTS } from '../core/tables';
import { alertItems, markAlertsRead, unreadCounts } from '../core/queries';

let db: Db;
beforeEach(() => {
  db = tempDb();
  seedArchiveViews(db);
  adoptAlerts(db);
  const add = db.prepare(`INSERT INTO ${ALERTS} (rule_id, message_id, channel_id, author_id, ts, snippet, created_at) VALUES (1, ?, 'c1', 'u1', ?, 'snippet', ?)`);
  for (const ts of [10, 20, 30]) add.run(`m${ts}`, ts, ts);
});

const shown = (span: { sinceTs?: number; untilTs?: number }): number[] =>
  alertItems(db, (ids) => archivePayloads(db, ids), { limit: 10, ...span }).map((a) => a.ts);

describe('alerts within a time span', () => {
  it('lists, counts and marks read only the alerts in it, both ends inclusive', () => {
    expect(shown({ sinceTs: 20 })).toEqual([30, 20]);
    expect(shown({ untilTs: 20 })).toEqual([20, 10]);
    expect(shown({ sinceTs: 15, untilTs: 25 })).toEqual([20]);
    expect(unreadCounts(db, { sinceTs: 15, untilTs: 25 })).toEqual({ 1: 1 });
    markAlertsRead(db, null, undefined, { sinceTs: 15, untilTs: 25 });
    expect(unreadCounts(db)).toEqual({ 1: 2 });
    expect(unreadCounts(db, { sinceTs: 15, untilTs: 25 })).toEqual({});
  });

  it('decodes a span with integer ends and refuses any other', () => {
    expect(decodeMarkRead([null, [1], { sinceTs: 5 }])).toEqual([null, [1], { sinceTs: 5 }]);
    expect(decodeMarkRead([null])).toEqual([null, undefined, undefined]);
    expect(decodeUnread([{ untilTs: 9 }])).toEqual([{ untilTs: 9 }]);
    for (const bad of [null, [], { sinceTs: 1.5 }, { untilTs: '9' }]) expect(() => decodeUnread([bad])).toThrow();
  });
});
