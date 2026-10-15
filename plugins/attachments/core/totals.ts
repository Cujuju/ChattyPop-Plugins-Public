import type { PluginDb } from '@plugin-sdk/core';
import { emptyTotals, type AttachmentFilter, type AttachmentKind, type AttachmentPlaces, type AttachmentTotals, type PeopleQuery, type PersonRow } from '../shared/types';
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

/** Counts by server and channel, a thread's under its channel as the channel filter scopes it; the place filter is ignored. */
export function attachmentPlaces(db: PluginDb, f: AttachmentFilter): AttachmentPlaces {
  const w = attachmentWhere({ ...f, guildId: undefined, channelId: undefined });
  const rows = db.prepare(`SELECT COALESCE(c.guild_id, '') AS guildId,
      CASE WHEN c.is_thread = 1 AND c.parent_id IS NOT NULL THEN c.parent_id ELSE a.channel_id END AS channelId, COUNT(*) AS count
    ${ATTACHMENT_FROM} WHERE ${w.sql} GROUP BY 1, 2`).all(...w.params) as { guildId: string; channelId: string; count: number }[];
  const out: AttachmentPlaces = { guilds: {}, channels: {} };
  for (const r of rows) {
    out.guilds[r.guildId] = (out.guilds[r.guildId] ?? 0) + r.count;
    out.channels[r.channelId] = (out.channels[r.channelId] ?? 0) + r.count;
  }
  return out;
}

/** People ranked by bytes on this PC (each stored file once per person), then count; their own filter is ignored. */
export function attachmentPeople(db: PluginDb, q: PeopleQuery): PersonRow[] {
  const w = attachmentWhere({ ...q, authorId: undefined });
  return db.prepare(`WITH matched AS (
      SELECT COALESCE(m.author_id, '') AS id, COALESCE(m.author_name, 'Unknown person') AS name, a.sha256, ${DISK_BYTES} AS bytes
      ${ATTACHMENT_FROM} WHERE ${w.sql}
    ), files AS (SELECT id, sha256, MAX(bytes) AS bytes FROM matched WHERE bytes > 0 GROUP BY id, sha256),
    sizes AS (SELECT id, SUM(bytes) AS bytes FROM files GROUP BY id)
    SELECT m.id, MIN(m.name) AS name, COUNT(*) AS count, COALESCE(s.bytes, 0) AS bytes
    FROM matched m LEFT JOIN sizes s ON s.id = m.id GROUP BY m.id
    ORDER BY bytes DESC, count DESC, m.id LIMIT ?`).all(...w.params, q.limit) as PersonRow[];
}