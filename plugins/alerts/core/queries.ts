// Privacy-aware inbox queries and read state.
import { mentionsFrom, type PluginDb, type ArchivePayloadReader, toolScopeSql } from '@plugin-sdk/core';
import { HELD_REASONS, type AlertItem, type AlertQuery, type AlertSpan, type HeldReason } from '../shared/types';
import { HELD_COLUMN } from './schema';
import { ALERTS, VISIBLE_ALERTS } from './tables';
import type { ArchiveToolScope } from '@plugin-sdk/core';

/** A stored held reason; one this build doesn't know reads as none. */
const heldReason = (v: string | null): HeldReason | null => (HELD_REASONS as readonly string[]).includes(v ?? '') ? (v as HeldReason) : null;

type AlertRow = Omit<AlertItem, 'mentions' | 'held'> & { heldDesktop: string | null; heldPhone: string | null };
export interface AlertToolFilter { scope: ArchiveToolScope; rule?: string; unread?: boolean }

/** A span's bounds on the alerts aliased `a`. */
function spanSql(span: AlertSpan | undefined): { where: string[]; params: number[] } {
  const where: string[] = [];
  const params: number[] = [];
  if (span?.sinceTs !== undefined) { where.push('a.ts >= ?'); params.push(span.sinceTs); }
  if (span?.untilTs !== undefined) { where.push('a.ts <= ?'); params.push(span.untilTs); }
  return { where, params };
}

/** Alerts newest first, less those privacy mode hides; `onlyId` narrows to one alert. */
export function alertItems(db: PluginDb, payloads: ArchivePayloadReader, q: AlertQuery, onlyId?: number): AlertItem[] {
  const query = alertsSql(q, onlyId);
  const rows = db.prepare(query.sql).all(...query.params) as AlertRow[];
  const details = payloads(rows.map((row) => row.messageId));
  return rows.map(({ heldDesktop, heldPhone, ...a }) => ({
    ...a,
    mentions: mentionsFrom(details.get(a.messageId)?.mentionsJson ?? null),
    held: { desktop: heldReason(heldDesktop), phone: heldReason(heldPhone) },
  }));
}

/** The inbox statement; `tool` adds an AI tool's scope and filters. */
export function alertsSql(q: AlertQuery, onlyId?: number, tool?: AlertToolFilter): { sql: string; params: (string | number)[] } {
  const where: string[] = ['1'];
  const params: (string | number)[] = [];
  if (tool) {
    const scoped = toolScopeSql(tool.scope);
    where.push(scoped.sql);
    params.push(...scoped.params);
    if (tool.rule !== undefined) {
      where.push('(CAST(r.id AS TEXT) = ? OR instr(lower(r.name), lower(?)) > 0)');
      params.push(tool.rule, tool.rule);
    }
    if (tool.unread !== undefined) where.push(tool.unread ? 'a.read_at IS NULL' : 'a.read_at IS NOT NULL');
  }
  if (onlyId !== undefined) {
    where.push('a.id = ?');
    params.push(onlyId);
  }
  if (q.unreadOnly) where.push('a.read_at IS NULL');
  if (q.ruleIds?.length) {
    where.push(`a.rule_id IN (${q.ruleIds.map(() => '?').join(', ')})`);
    params.push(...q.ruleIds);
  }
  const spanned = spanSql(q);
  where.push(...spanned.where);
  params.push(...spanned.params);
  if (q.after) {
    where.push('(a.ts, a.id) < (?, ?)');
    params.push(q.after.ts, q.after.id);
  }
  return {
    sql: `SELECT a.id, a.rule_id AS ruleId, r.name AS sourceName, a.message_id AS messageId, a.channel_id AS channelId,
              COALESCE(c.name, a.channel_id) AS channelName, a.author_id AS authorId,
              COALESCE((SELECT n.name FROM archive_names n WHERE n.channel_id = a.channel_id AND n.user_id = a.author_id), u.display_name, a.author_id) AS authorName, u.avatar AS authorAvatar,
              a.ts, a.snippet, a.read_at AS readAt, a.match_kind AS matchKind,
              a.probability, a.duplicate_of AS duplicateOf, a.${HELD_COLUMN.desktop} AS heldDesktop, a.${HELD_COLUMN.phone} AS heldPhone
       FROM ${VISIBLE_ALERTS} a JOIN archive_rules r ON r.id = a.rule_id
       ${tool ? 'JOIN archive_messages m ON m.id = a.message_id' : ''}
       LEFT JOIN archive_channels c ON c.id = a.channel_id LEFT JOIN archive_users u ON u.id = a.author_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.ts DESC, a.id DESC LIMIT ?`,
    params: [...params, q.limit],
  };
}

/** Marks alerts read: the given ids, or every visible unread one (of these rules when any, within the span); hidden ones stay unread. */
export function markAlertsRead(db: PluginDb, ids: number[] | null, ruleIds?: number[], span?: AlertSpan): void {
  const now = Date.now();
  if (ids) {
    const mark = db.prepare(`UPDATE ${ALERTS} SET read_at = ? WHERE id = ? AND read_at IS NULL`);
    db.transaction(() => ids.forEach((id) => mark.run(now, id)))();
    return;
  }
  const spanned = spanSql(span);
  const where = ['a.read_at IS NULL', ...(ruleIds?.length ? [`a.rule_id IN (${ruleIds.map(() => '?').join(', ')})`] : []), ...spanned.where];
  db.prepare(`UPDATE ${ALERTS} SET read_at = ? WHERE read_at IS NULL AND id IN (SELECT a.id FROM ${VISIBLE_ALERTS} a WHERE ${where.join(' AND ')})`).run(
    now,
    ...(ruleIds ?? []),
    ...spanned.params,
  );
}

/** Unread counts grouped by rule (within the span when given), excluding hidden messages. */
export function unreadCounts(db: PluginDb, span?: AlertSpan): Record<number, number> {
  const spanned = spanSql(span);
  const rows = db.prepare(
    `SELECT a.rule_id AS id, COUNT(*) AS n FROM ${VISIBLE_ALERTS} a WHERE ${['a.read_at IS NULL', ...spanned.where].join(' AND ')} GROUP BY a.rule_id`,
  ).all(...spanned.params) as { id: number; n: number }[];
  return Object.fromEntries(rows.map((row) => [row.id, row.n]));
}
