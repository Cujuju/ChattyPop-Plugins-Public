// #89: archives direct rule matches. Matches predating the rule or already read by the owner are stored read without further processing.
import { type PluginDb, type RuleHistory } from '@plugin-sdk/core';
import { INSERT_ALERT, alertText, snippet } from './rows';
import { ALERTS } from './tables';

const MATCH_KIND = { pattern: 'pattern' } as const;

/**
 * Synchronizes direct-match alert history, preserving kept alerts' read state; `messageRead`: the owner read it
 * (ctx.archive.messageRead). Reconcile drops Jev matches when the question changes.
 */
export function syncHistory(db: PluginDb, ruleId: number, history: RuleHistory, messageRead: (messageId: string) => boolean): void {
  const matches = history.matches();
  const keep = new Set(matches.map(({ m }) => m.id));
  const now = Date.now();
  db.transaction(() => {
    const existing = db
      .prepare(`SELECT id, message_id FROM ${ALERTS} WHERE rule_id = ? AND match_kind = ?`)
      .all(ruleId, MATCH_KIND.pattern) as { id: number; message_id: string }[];
    const drop = db.prepare(`DELETE FROM ${ALERTS} WHERE id = ?`);
    if (history.syncDirect) for (const a of existing) if (!keep.has(a.message_id)) drop.run(a.id);
    const insert = db.prepare(INSERT_ALERT);
    for (const { m, hit, contents } of matches) {
      const text = alertText(m, () => new Set(contents));
      insert.run(
        ruleId,
        m.id,
        m.channelId,
        m.authorId,
        m.ts,
        snippet(text, hit.highlight),
        now,
        m.ts >= history.armedAt && !messageRead(m.id) ? null : now,
        MATCH_KIND.pattern,
        null,
      );
    }
  })();
}
