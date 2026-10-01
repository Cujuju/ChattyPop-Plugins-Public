// #55: a live alert about the same event as its rule's recent alert doesn't notify again.
import { errorMessage, MS_PER_HOUR } from '@plugin-sdk/shared';
import { clipMessage, LocalOnlyError, queryMatch, queryRequest, type PluginDecider, type PluginDb } from '@plugin-sdk/core';
import { ALERTS } from './tables';

/** A repeat within a few hours is usually the same news making the rounds; after that it's more likely a new event. */
const DEDUPE_WINDOW_MS = 6 * MS_PER_HOUR;
/** Settings → Jev → Queries id; its condition decides what counts as a repeat. */
const SAME_EVENT_QUERY = 'alerts.sameEvent';

interface AlertText {
  id: number;
  channelId: string;
  text: string;
}

export const alertText = (db: PluginDb, alertId: number): AlertText | undefined =>
  db
    .prepare(
      `SELECT a.id, a.channel_id AS channelId, COALESCE(u.display_name, a.author_id) || ': ' || COALESCE(NULLIF((SELECT text FROM archive_all_messages WHERE id = a.message_id), ''), a.snippet) AS text
       FROM ${ALERTS} a LEFT JOIN archive_users u ON u.id = a.author_id WHERE a.id = ?`,
    )
    .get(alertId) as AlertText | undefined;

/**
 * Resolves true when the alert repeats the rule's most recent earlier alert (within the window), and records that
 * on the alert. Resolves false (notify) when there is nothing to compare, the text is local-only, or Jev fails.
 * Earlier is by (ts, id): alerts judged at once never pick each other, so a burst can't mark every alert a repeat.
 */
export async function isRepeat(db: PluginDb, jev: PluginDecider, ruleId: number, alertId: number, active: () => boolean = () => true): Promise<boolean> {
  const now = Date.now();
  const prevId = (
    db
      .prepare(
        `SELECT p.id FROM ${ALERTS} p JOIN ${ALERTS} c ON c.id = ?
         WHERE p.rule_id = ? AND p.duplicate_of IS NULL AND p.ts >= ? AND (p.ts, p.id) < (c.ts, c.id) ORDER BY p.ts DESC, p.id DESC LIMIT 1`,
      )
      .get(alertId, ruleId, now - DEDUPE_WINDOW_MS) as { id: number } | undefined
  )?.id;
  if (prevId === undefined) return false;
  const current = alertText(db, alertId);
  const previous = alertText(db, prevId);
  if (!current || !previous) return false;
  try {
    const { answers } = await jev.decide({
      state: { previous: clipMessage(previous.text), message: clipMessage(current.text) },
      questions: { same: queryRequest(SAME_EVENT_QUERY) },
      reads: [previous.channelId, current.channelId],
    });
    const a = answers.same;
    if (!a || queryMatch(SAME_EVENT_QUERY, a) === null) return false;
    if (!active()) return false;
    db.prepare(`UPDATE ${ALERTS} SET duplicate_of = ? WHERE id = ?`).run(prevId, alertId);
    return true;
  } catch (err) {
    // Jev may not read a local-AI-only channel: nothing to compare, so it notifies.
    if (!(err instanceof LocalOnlyError)) console.warn('[jev] dedupe failed; notifying:', errorMessage(err));
    return false;
  }
}
