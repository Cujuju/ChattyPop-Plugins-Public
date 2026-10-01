// Privacy-aware inbox queries and read state.
import { mentionsFrom, type PluginDb, type ArchivePayloadReader } from '@plugin-sdk/core';
import type { AlertItem, AlertQuery } from '../shared/types';
import { ALERTS, VISIBLE_ALERTS } from './tables';

/** Alerts newest first, less those privacy mode hides; `onlyId` narrows to one alert. */
export function alertItems(db: PluginDb, payloads: ArchivePayloadReader, q: AlertQuery, onlyId?: number): AlertItem[] {
  const where: string[] = ['1'];
  const params: (string | number)[] = [];
  if (onlyId !== undefined) {
    where.push('a.id = ?');
    params.push(onlyId);
  }
  if (q.unreadOnly) where.push('a.read_at IS NULL');
  if (q.ruleIds?.length) {
    where.push(`a.rule_id IN (${q.ruleIds.map(() => '?').join(', ')})`);
    params.push(...q.ruleIds);
  }
  if (q.after) {
    where.push('(a.ts, a.id) < (?, ?)');
    params.push(q.after.ts, q.after.id);
  }
  const rows = db
    .prepare(
      `SELECT a.id, a.rule_id AS ruleId, r.name AS sourceName, a.message_id AS messageId, a.channel_id AS channelId,
              COALESCE(c.name, a.channel_id) AS channelName, a.author_id AS authorId,
              COALESCE((SELECT n.name FROM archive_names n WHERE n.channel_id = a.channel_id AND n.user_id = a.author_id), u.display_name, a.author_id) AS authorName, u.avatar AS authorAvatar,
              a.ts, a.snippet, a.read_at AS readAt, a.match_kind AS matchKind,
              a.probability, a.duplicate_of AS duplicateOf
       FROM ${VISIBLE_ALERTS} a JOIN archive_rules r ON r.id = a.rule_id
       LEFT JOIN archive_channels c ON c.id = a.channel_id LEFT JOIN archive_users u ON u.id = a.author_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.ts DESC, a.id DESC LIMIT ?`,
    )
    .all(...params, q.limit) as Omit<AlertItem, 'mentions'>[];
  const details = payloads(rows.map((row) => row.messageId));
  return rows.map((a) => ({ ...a, mentions: mentionsFrom(details.get(a.messageId)?.mentionsJson ?? null) }));
}

/** Marks alerts read: the given ids, or every visible unread one (of these rules when any); hidden ones stay unread. */
export function markAlertsRead(db: PluginDb, ids: number[] | null, ruleIds?: number[]): void {
  const now = Date.now();
  if (ids) {
    const mark = db.prepare(`UPDATE ${ALERTS} SET read_at = ? WHERE id = ? AND read_at IS NULL`);
    db.transaction(() => ids.forEach((id) => mark.run(now, id)))();
    return;
  }
  const only = ruleIds?.length ? ` AND a.rule_id IN (${ruleIds.map(() => '?').join(', ')})` : '';
  db.prepare(`UPDATE ${ALERTS} SET read_at = ? WHERE read_at IS NULL AND id IN (SELECT a.id FROM ${VISIBLE_ALERTS} a WHERE a.read_at IS NULL${only})`).run(
    now,
    ...(ruleIds ?? []),
  );
}

/** Unread counts grouped by rule, excluding hidden messages. */
export function unreadCounts(db: PluginDb): Record<number, number> {
  const rows = db.prepare(
    `SELECT a.rule_id AS id, COUNT(*) AS n FROM ${VISIBLE_ALERTS} a WHERE a.read_at IS NULL GROUP BY a.rule_id`,
  ).all() as { id: number; n: number }[];
  return Object.fromEntries(rows.map((row) => [row.id, row.n]));
}
