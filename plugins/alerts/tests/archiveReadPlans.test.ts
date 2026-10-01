// Alerts' archive reads use indexes and decode only what they need.
import { describe, expect, it } from 'vitest';
import { compressRawJson, type Db } from '@core/db';
import { archiveReplyExists } from '@core/plugins/archiveReplies';
import { adoptBundledData } from '@core/plugins/adoption';
import { createArchiveRefViews } from '@core/plugins/archiveRefs';
import { textMessage } from '@core/queries/messageText';
import { tempDb } from '@chattypop/host-testing';
import { seedArchiveViews } from '@chattypop/host-testing/archiveViewsFixture';
import { statementPlans } from '@chattypop/host-testing/queryPlan';
import { plugin } from '../shared';
import { ALERTS } from '../core/tables';
import { alertItems } from '../core/queries';
import { alertText } from '../core/dedupe';
import { hasReply } from '../core/rows';

/** Capture the production statement and inspect its actual bound query plan. */
function plan(db: Db, read: () => unknown): string[] {
  const details = statementPlans(db, read);
  expect(details.length).toBeGreaterThan(0);
  expect(details.join('\n')).not.toMatch(/MATERIALIZE|AUTOMATIC .*INDEX|SCAN (?:m\b|messages\b|archive_(?:all_)?(?:messages|names)\b)/i);
  return details;
}

describe('archive read plans', () => {
  it('uses indexed names and message text for both an alerts page and a single notification', () => {
    const db = tempDb();
    seedArchiveViews(db);
    adoptBundledData(db, [plugin]);
    createArchiveRefViews(db, plugin);
    db.exec(`INSERT INTO ${ALERTS} (rule_id, message_id, channel_id, author_id, ts, snippet, created_at)
      VALUES (1, 'm-open', 'c-open', 'u1', 1, 'fallback', 1)`);
    const id = db.prepare(`SELECT id FROM ${ALERTS}`).pluck().get() as number;
    for (const onlyId of [undefined, id]) {
      const details = plan(db, () => {
        expect(alertItems(db, () => new Map(), { limit: 20 }, onlyId)[0]?.authorName).toBe('Ally');
      });
      expect(details.join('\n')).toMatch(/SEARCH mem USING INDEX/);
    }
    const details = plan(db, () => expect(alertText(db, id)?.text).toBe('Alice: hello open\nfirst\nsecond'));
    expect(details.join('\n')).toMatch(/SEARCH m USING INDEX/);
  });

  it('checks replies with indexed early exit', () => {
    const db = tempDb();
    seedArchiveViews(db);
    db.prepare("UPDATE messages SET author_id = 'u2', raw_json = ? WHERE id = 'm-ref-channel'")
      .run(compressRawJson(JSON.stringify({ type: 19, message_reference: { message_id: 'm-open' } })));
    plan(db, () => expect(hasReply((...args) => archiveReplyExists(db, ...args), textMessage(db, 'm-open')!)).toBe(true));
  });
});
