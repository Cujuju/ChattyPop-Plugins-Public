// Reconcile persisted inbox state after rule edits, activation and kind availability changes.
import { questionSignature, type CoreContext } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { ALERTS } from './tables';
import { RULE_QUESTIONS } from './schema';
import { syncHistory } from './history';

/** Persisted signatures survive periods when Alerts cannot receive rule events; history ones only a gapless restart. */
export function reconcileAlertHistory(ctx: CoreContext<typeof plugin>, changed: () => void): () => void {
  const db = ctx.storage.db;
  // After a gap, rules ran while Alerts couldn't record their matches: every rule's history is synced again.
  if (!ctx.session.resumed) db.prepare(`UPDATE ${RULE_QUESTIONS} SET history_signature = NULL`).run();
  return () => {
    const rows = ctx.rules.read();
    db.transaction(() => {
      const read = db.prepare(`SELECT signature, history_signature FROM ${RULE_QUESTIONS} WHERE rule_id = ?`);
      const save = db.prepare(`INSERT INTO ${RULE_QUESTIONS} (rule_id, signature) VALUES (?, ?)
        ON CONFLICT(rule_id) DO UPDATE SET signature = excluded.signature`);
      for (const row of rows) {
        const signature = questionSignature(row.spec);
        const old = read.get(row.id) as { signature: string; history_signature: string | null } | undefined;
        // No baseline (first run): the question was never edited unseen, since every earlier edit path dropped stale alerts.
        if (old && old.signature !== signature)
          db.prepare(`DELETE FROM ${ALERTS} WHERE rule_id = ? AND match_kind = 'meaning'`).run(row.id);
        save.run(row.id, signature);
        if (!row.spec?.actions.some((action) => action.type === 'alerts.notify')) continue;
        // Cheap: the archive is read only by syncHistory, after the signature shows the stored history is stale.
        const history = ctx.rules.history('alerts.notify', row.id);
        // A rule that isn't compiled (off, or a kind's plugin off) matches nothing meanwhile; it syncs again once it runs.
        const historySignature = history ? JSON.stringify(row.spec) : null;
        if (old?.history_signature === historySignature) continue;
        if (history) syncHistory(db, row.id, history);
        db.prepare(`UPDATE ${RULE_QUESTIONS} SET history_signature = ? WHERE rule_id = ?`).run(historySignature, row.id);
      }
      db.prepare(`DELETE FROM ${RULE_QUESTIONS} WHERE rule_id NOT IN (SELECT value FROM json_each(?))`)
        .run(JSON.stringify(rows.map((row) => row.id)));
    })();
    changed();
  };
}
