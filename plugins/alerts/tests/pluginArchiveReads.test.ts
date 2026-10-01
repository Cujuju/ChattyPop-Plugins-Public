// Alerts' inbox reads keep orphan references and privacy-visible counts.
import { beforeEach, describe, expect, it } from 'vitest';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { setSetting, type Db } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { visibleMessageRefSql } from '@core/queries/privacy';
import { tempDb } from '@chattypop/host-testing';
import { seedArchiveViews } from '@chattypop/host-testing/archiveViewsFixture';
import { plugin as alerts } from '../shared';
import { ALERTS } from '../core/tables';
import { alertItems, markAlertsRead, unreadCounts } from '../core/queries';

let db: Db;
beforeEach(() => {
  db = tempDb();
  seedArchiveViews(db);
  adoptBundledData(db, [alerts]);
});

describe('plugin archive read parity', () => {
  it('preserves orphan inbox records, nickname fallback, counts and mark-all-read scope', () => {
    db.exec(`INSERT INTO ${ALERTS} (rule_id, message_id, channel_id, author_id, ts, snippet, created_at)
      SELECT 1, message_id, channel_id, 'u1', 1, 'snippet', 1 FROM archive_all_attachments`);
    for (const mode of [false, true]) {
      setSetting(db, 'privacyMode', mode);
      const expected = db.prepare(`SELECT a.id FROM ${ALERTS} a WHERE ${visibleMessageRefSql('a.channel_id', 'a.message_id')} ORDER BY a.id DESC`).pluck().all();
      expect(alertItems(db, (ids) => archivePayloads(db, ids), { limit: 100 }).map((item) => item.id)).toEqual(expected);
      expect(unreadCounts(db)).toEqual({ 1: expected.length });
    }
    const orphan = alertItems(db, (ids) => archivePayloads(db, ids), { limit: 100 }).find((item) => item.messageId === 'gone');
    expect(orphan?.authorName).toBe('Ally');
    markAlertsRead(db, null);
    expect(unreadCounts(db)).toEqual({});
    expect(db.prepare(`SELECT COUNT(*) FROM ${ALERTS} WHERE read_at IS NULL`).pluck().get()).toBe(6);
  });
});
