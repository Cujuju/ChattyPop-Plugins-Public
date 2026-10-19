import type { ArchiveRead } from '@plugin-sdk/core';
import { BREAKDOWN_LIMIT, type AttachmentBreakdown, type AttachmentFilter, type AttachmentPosting, type BreakdownBy } from '../shared/types';
import { ATTACHMENT_FROM, AUTHOR_ID, AUTHOR_NAME, DISK_BYTES, attachmentWhere, messageColumn } from './filters';
import { aggregateSource } from './aggregateSource';
import type { AttachmentRollups } from './rollups';

export async function attachmentPostings(read: ArchiveRead, sha256: string): Promise<AttachmentPosting[]> {
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Not an attachment hash.');
  return (await read(`SELECT a.id, a.message_id AS messageId, a.channel_id AS channelId,
    COALESCE(c.name, a.channel_id) AS channelName, c.guild_id AS guildId, COALESCE(g.name, '') AS guildName,
    ${AUTHOR_ID} AS authorId, COALESCE(${AUTHOR_NAME}, '') AS authorName, a.ts
    ${ATTACHMENT_FROM} WHERE a.sha256 = ? ORDER BY a.ts DESC, a.id DESC`, [sha256])) as AttachmentPosting[];
}

const GROUP_KEY: Record<BreakdownBy, string> = {
  guild: "COALESCE(c.guild_id, '')",
  channel: 'CASE WHEN c.is_thread = 1 AND c.parent_id IS NOT NULL THEN c.parent_id ELSE a.channel_id END',
  person: `COALESCE(${AUTHOR_ID}, '')`, kind: 'a.kind',
};
const GROUP_LABEL: Record<BreakdownBy, string> = {
  guild: "COALESCE((SELECT name FROM archive_guilds WHERE id = ranked.key), 'Unknown server')",
  channel: "COALESCE((SELECT name FROM archive_channels WHERE id = ranked.key), ranked.key)",
  person: `COALESCE(${messageColumn('author_name', 'ranked.messageId')}, 'Unknown person')`,
  kind: 'ranked.key',
};

/** One materialized filtered pass; each hash counts once within a group, and once across the remainder. */
export async function attachmentBreakdown(read: ArchiveRead, f: AttachmentFilter, by: BreakdownBy, rollups?: AttachmentRollups): Promise<AttachmentBreakdown[]> {
  if (!Object.hasOwn(GROUP_KEY, by)) throw new Error('Not a breakdown dimension.');
  const s = aggregateSource(read, f, rollups);
  const w = s.where;
  const label = GROUP_LABEL[by];
  const rows = (await s.read(`WITH matched AS MATERIALIZED (
      SELECT ${by === 'person' ? `COALESCE(${s.author}, '')` : GROUP_KEY[by]} AS key, a.sha256, ${s.bytes} AS bytes, a.ts, a.message_id AS messageId, ${s.n} AS n
      ${s.from} WHERE ${w.sql}
    ), files AS (SELECT key, sha256, MAX(bytes) AS bytes FROM matched WHERE bytes > 0 GROUP BY key, sha256),
    sizes AS (SELECT key, SUM(bytes) AS bytes FROM files GROUP BY key),
    ranked AS MATERIALIZED (
      SELECT m.key, m.messageId, MAX(m.ts), SUM(m.n) AS count, COALESCE(s.bytes, 0) AS bytes
      FROM matched m LEFT JOIN sizes s ON s.key = m.key GROUP BY m.key
    ), top AS MATERIALIZED (SELECT key FROM ranked ORDER BY bytes DESC, count DESC, key LIMIT ?),
    rest AS MATERIALIZED (SELECT * FROM ranked WHERE key NOT IN (SELECT key FROM top)),
    result AS (SELECT key, ${label} AS label, bytes, count, NULL AS groups FROM ranked WHERE key IN (SELECT key FROM top)
    UNION ALL
    SELECT NULL AS key, 'Other' AS label,
      (SELECT COALESCE(SUM(bytes), 0) FROM (SELECT MAX(bytes) AS bytes FROM files WHERE key IN (SELECT key FROM rest) GROUP BY sha256)),
      SUM(count), COUNT(*) AS groups FROM rest HAVING COUNT(*) > 0)
    SELECT *, (SELECT SUM(n) FROM matched) AS totalCount,
      (SELECT COALESCE(SUM(bytes), 0) FROM (SELECT MAX(bytes) AS bytes FROM files GROUP BY sha256)) AS totalBytes
    FROM result ORDER BY groups IS NOT NULL, bytes DESC, count DESC, key`, [...w.params, BREAKDOWN_LIMIT])) as AttachmentBreakdown[];
  return s.current() ? rows : attachmentBreakdown(read, f, by);
}
