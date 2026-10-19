import type { ArchiveRead } from '@plugin-sdk/core';
import { emptyTotals, type AttachmentFilter, type AttachmentKind, type AttachmentPlaces, type AttachmentTotals, type PeopleQuery, type PersonRow } from '../shared/types';
import { messageColumn } from './filters';
import { aggregateSource } from './aggregateSource';
import type { AttachmentRollups } from './rollups';

/**
 * Counts attachments and deduplicates each stored file's bytes by SHA, globally and within each kind. One pass over the
 * matched rows (MATERIALIZED: an author filter's per-row lookup runs once).
 */
export async function attachmentTotals(read: ArchiveRead, f: AttachmentFilter, rollups?: AttachmentRollups): Promise<AttachmentTotals> {
  const s = aggregateSource(read, { ...f, kinds: undefined }, rollups);
  const w = s.where;
  const kinds = (await s.read(`WITH matched AS MATERIALIZED (SELECT a.kind, a.sha256, ${s.bytes} AS bytes, ${s.n} AS n ${s.from} WHERE ${w.sql}),
    files AS MATERIALIZED (SELECT kind, sha256, MAX(bytes) AS bytes FROM matched WHERE bytes > 0 GROUP BY kind, sha256),
    sizes AS (SELECT kind, SUM(bytes) AS bytes FROM files GROUP BY kind)
    SELECT m.kind, SUM(m.n) AS count, COALESCE(s.bytes, 0) AS bytes,
      (SELECT COALESCE(SUM(bytes), 0) FROM (SELECT MAX(bytes) AS bytes FROM files GROUP BY sha256)) AS disk
    FROM matched m LEFT JOIN sizes s ON s.kind = m.kind GROUP BY m.kind`, [...w.params])) as { kind: AttachmentKind; count: number; bytes: number; disk: number }[];
  const out = emptyTotals();
  for (const row of kinds) { out.byKind[row.kind] = { count: row.count, bytes: row.bytes }; out.count += row.count; out.bytes = row.disk; }
  return s.current() ? out : attachmentTotals(read, f);
}

/**
 * Counts by server, channel and thread; a thread's also count in its channel, as the channel filter scopes them. The
 * place filter is ignored.
 */
export async function attachmentPlaces(read: ArchiveRead, f: AttachmentFilter, rollups?: AttachmentRollups): Promise<AttachmentPlaces> {
  const s = aggregateSource(read, { ...f, guildId: undefined, channelId: undefined }, rollups, false);
  const w = s.where;
  const inThread = 'c.is_thread = 1 AND c.parent_id IS NOT NULL';
  const rows = (await s.read(`SELECT COALESCE(c.guild_id, '') AS guildId,
      CASE WHEN ${inThread} THEN c.parent_id ELSE a.channel_id END AS channelId,
      CASE WHEN ${inThread} THEN a.channel_id END AS threadId, ${s.count} AS count
    ${s.from} WHERE ${w.sql} GROUP BY 1, 2, 3`, [...w.params])) as { guildId: string; channelId: string; threadId: string | null; count: number }[];
  const out: AttachmentPlaces = { guilds: {}, channels: {}, threads: {} };
  for (const r of rows) {
    out.guilds[r.guildId] = (out.guilds[r.guildId] ?? 0) + r.count;
    out.channels[r.channelId] = (out.channels[r.channelId] ?? 0) + r.count;
    if (r.threadId !== null) out.threads[r.threadId] = r.count;
  }
  return s.current() ? out : attachmentPlaces(read, f);
}

/**
 * People ranked by bytes on this PC (each stored file once per person), then count; their own filter is ignored. A name is
 * the one on the person's newest file, looked up for the listed people only.
 */
export async function attachmentPeople(read: ArchiveRead, q: PeopleQuery, rollups?: AttachmentRollups): Promise<PersonRow[]> {
  const s = aggregateSource(read, { ...q, authorId: undefined }, rollups);
  const w = s.where;
  const rows = (await s.read(`WITH matched AS MATERIALIZED (
      SELECT COALESCE(${s.author}, '') AS id, a.message_id AS messageId, a.ts, a.sha256, ${s.bytes} AS bytes, ${s.n} AS n
      ${s.from} WHERE ${w.sql}
    ), files AS (SELECT id, sha256, MAX(bytes) AS bytes FROM matched WHERE bytes > 0 GROUP BY id, sha256),
    sizes AS (SELECT id, SUM(bytes) AS bytes FROM files GROUP BY id),
    -- SQLite takes a bare column (messageId) from the row MAX(ts) picks.
    ranked AS (SELECT m.id, m.messageId, MAX(m.ts), SUM(m.n) AS count, COALESCE(s.bytes, 0) AS bytes
      FROM matched m LEFT JOIN sizes s ON s.id = m.id GROUP BY m.id ORDER BY bytes DESC, count DESC, m.id LIMIT ?)
    SELECT id, COALESCE(${messageColumn('author_name', 'ranked.messageId')}, 'Unknown person') AS name, count, bytes
    FROM ranked ORDER BY bytes DESC, count DESC, id`, [...w.params, q.limit])) as PersonRow[];
  return s.current() ? rows : attachmentPeople(read, q);
}
