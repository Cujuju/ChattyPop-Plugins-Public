import type { PluginDb } from '@plugin-sdk/core';
import { emptyTotals, type AttachmentFilter, type AttachmentKind, type AttachmentTotals, type BreakdownBy, type BreakdownQuery, type BreakdownRow } from '../shared/types';
import { ATTACHMENT_FROM, DISK_BYTES, attachmentWhere } from './filters';

/** Counts attachments and deduplicates each stored file's bytes by SHA, globally and within each kind. */
export function attachmentTotals(db: PluginDb, f: AttachmentFilter): AttachmentTotals {
  const w = attachmentWhere({ ...f, kinds: undefined });
  const matched = `SELECT a.kind, a.sha256, ${DISK_BYTES} AS bytes ${ATTACHMENT_FROM} WHERE ${w.sql}`;
  const kinds = db.prepare(`WITH matched AS (${matched}),
    files AS (SELECT kind, sha256, MAX(bytes) AS bytes FROM matched WHERE bytes > 0 GROUP BY kind, sha256),
    sizes AS (SELECT kind, SUM(bytes) AS bytes FROM files GROUP BY kind)
    SELECT m.kind, COUNT(*) AS count, COALESCE(s.bytes, 0) AS bytes FROM matched m
    LEFT JOIN sizes s ON s.kind = m.kind GROUP BY m.kind`).all(...w.params) as { kind: AttachmentKind; count: number; bytes: number }[];
  const disk = db.prepare(`WITH matched AS (${matched}) SELECT COALESCE(SUM(bytes), 0) AS bytes
    FROM (SELECT MAX(bytes) AS bytes FROM matched WHERE bytes > 0 GROUP BY sha256)`).get(...w.params) as { bytes: number };
  const out = emptyTotals();
  for (const row of kinds) { out.byKind[row.kind] = { count: row.count, bytes: row.bytes }; out.count += row.count; }
  out.bytes = disk.bytes;
  return out;
}

const DIMENSIONS: Record<BreakdownBy, { id: string; name: string; detail: string }> = {
  guild: { id: "COALESCE(c.guild_id, '')", name: "COALESCE(g.name, 'Unknown server')", detail: "''" },
  channel: { id: 'a.channel_id', name: 'COALESCE(c.name, a.channel_id)', detail: "COALESCE(g.name, '')" },
  author: { id: "COALESCE(m.author_id, '')", name: "COALESCE(m.author_name, 'Unknown person')", detail: "''" },
};

/** Each dimension ignores its own filter, counting stored SHA bytes once per group. */
export function attachmentBreakdown(db: PluginDb, q: BreakdownQuery): BreakdownRow[] {
  const filter = { ...q };
  if (q.by === 'guild') delete filter.guildId;
  if (q.by === 'channel') delete filter.channelId;
  if (q.by === 'author') delete filter.authorId;
  const w = attachmentWhere(filter);
  const d = DIMENSIONS[q.by];
  return db.prepare(`WITH matched AS (
      SELECT ${d.id} AS id, ${d.name} AS name, ${d.detail} AS detail, a.sha256, ${DISK_BYTES} AS bytes
      ${ATTACHMENT_FROM} WHERE ${w.sql}
    ), files AS (SELECT id, sha256, MAX(bytes) AS bytes FROM matched WHERE bytes > 0 GROUP BY id, sha256),
    sizes AS (SELECT id, SUM(bytes) AS bytes FROM files GROUP BY id)
    SELECT m.id, MIN(m.name) AS name, MIN(m.detail) AS detail, COUNT(*) AS count, COALESCE(s.bytes, 0) AS bytes
    FROM matched m LEFT JOIN sizes s ON s.id = m.id GROUP BY m.id
    ORDER BY bytes DESC, count DESC, m.id LIMIT ?`).all(...w.params, q.limit) as BreakdownRow[];
}
