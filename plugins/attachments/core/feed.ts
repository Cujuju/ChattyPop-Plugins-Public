import type { ArchiveMessage } from '@plugin-sdk/shared';
import type { PluginDb } from '@plugin-sdk/core';
import { NEWEST, type AttachmentCursor, type AttachmentItem, type AttachmentPageQuery, type AttachmentSortKey, type PersonFilesQuery } from '../shared/types';
import { ATTACHMENT_FROM, AUTHOR_ID, AUTHOR_NAME, DISK_BYTES, SIZE_KEY, attachmentWhere } from './filters';
import { attachmentTextMatches } from './textMatches';
import { monthBounds } from '../shared/months';

type AttachmentRow = Omit<AttachmentItem, 'compressed' | 'animated' | 'spoiler' | 'removed' | 'message'> & {
  compressedAt: number | null;
  removedAt: number | null;
};
type MessageReader = (ids: string[]) => ArchiveMessage[];

/** The column an order sorts by ahead of time and id; a date order is time alone. */
const SORT_COLUMN: Record<AttachmentSortKey, string | null> = { date: null, size: SIZE_KEY, name: 'a.filename COLLATE NOCASE', kind: 'a.kind' };

/** Row-value cursors over (key, time, id), all one direction; before reads run backwards, then reverse to return the nearest rows. */
export function attachmentRows(db: PluginDb, q: AttachmentPageQuery): AttachmentRow[] {
  const w = attachmentWhere(q);
  const sort = q.sort ?? NEWEST;
  if (sort.key === 'date' && q.startMonth) {
    const bounds = monthBounds(q.startMonth);
    if (!bounds) return [];
    w.sql += sort.dir === 'desc' ? ' AND a.ts < ?' : ' AND a.ts >= ?';
    w.params.push(sort.dir === 'desc' ? bounds.end : bounds.start);
  }
  if (sort.key === 'date' && q.startAt) {
    w.sql += ` AND (a.ts, a.id) ${sort.dir === 'desc' ? '<=' : '>='} (?, ?)`;
    w.params.push(q.startAt.ts, q.startAt.id);
  }
  const column = SORT_COLUMN[sort.key];
  const cursor: AttachmentCursor | undefined = q.before ?? q.after;
  const ascending = (sort.dir === 'asc') !== !!q.before;
  const op = ascending ? '>' : '<';
  const past = cursor ? ` AND (${column ? `${column}, ` : ''}a.ts, a.id) ${op} (${column ? '?, ' : ''}?, ?)` : '';
  const args = !cursor ? [] : column ? [cursor.key ?? null, cursor.ts, cursor.id] : [cursor.ts, cursor.id];
  const dir = ascending ? 'ASC' : 'DESC';
  const rows = db.prepare(`SELECT a.id, a.message_id AS messageId, a.channel_id AS channelId,
      COALESCE(c.name, a.channel_id) AS channelName, c.guild_id AS guildId, COALESCE(g.name, '') AS guildName,
      ${AUTHOR_ID} AS authorId, COALESCE(${AUTHOR_NAME}, '') AS authorName, a.ts,
      a.filename, a.content_type AS contentType, a.kind, a.size, ${DISK_BYTES} AS bytes, ${SIZE_KEY} AS sortBytes,
      a.width, a.height, a.sha256, a.stored_ext AS storedExt, a.status,
      a.compressed_at AS compressedAt, a.removed_at AS removedAt
    ${ATTACHMENT_FROM} WHERE ${w.sql}${past}
    ORDER BY ${column ? `${column} ${dir}, ` : ''}a.ts ${dir}, a.id ${dir} LIMIT ?`)
    .all(...w.params, ...args, q.limit) as Omit<AttachmentRow, 'postings'>[];
  const hashes = [...new Set(rows.flatMap((r) => r.sha256 ?? []))];
  // Count each page hash once, through the SHA index and privacy view; no full-archive grouping per page.
  const counts = hashes.length ? db.prepare(`SELECT sha256, COUNT(*) AS postings FROM archive_attachments
    WHERE sha256 IN (SELECT value FROM json_each(?)) GROUP BY sha256`).all(JSON.stringify(hashes)) as { sha256: string; postings: number }[] : [];
  const postings = new Map(counts.map((r) => [r.sha256, r.postings]));
  const items = rows.map((r) => ({ ...r, postings: r.sha256 ? postings.get(r.sha256) ?? 1 : 1 }));
  return q.before ? items.reverse() : items;
}

/** Archive attachment metadata supplies local edits and animation flags; orphan rows retain safe filename/MIME fallbacks. */
export function attachmentPage(db: PluginDb, messagesByIds: MessageReader, q: AttachmentPageQuery): AttachmentItem[] {
  const rows = attachmentRows(db, q);
  const textMatches = attachmentTextMatches(db, rows, q.name);
  const messages = new Map(messagesByIds([...new Set(rows.map((r) => r.messageId))]).map((m) => [m.id, m]));
  return rows.map(({ compressedAt, removedAt, ...row }) => {
    const message = messages.get(row.messageId) ?? null;
    const a = message?.attachments.find((a) => a.id === row.id);
    return {
      ...row, message, ...(textMatches.has(row.id) ? { textMatch: textMatches.get(row.id)! } : {}),
      compressed: a?.compressed ?? compressedAt !== null,
      animated: a?.animated ?? row.contentType?.toLowerCase() === 'image/gif',
      spoiler: a?.spoiler ?? row.filename.startsWith('SPOILER_'),
      removed: a?.removed ?? removedAt !== null,
    };
  });
}

export const personFiles = (db: PluginDb, messagesByIds: MessageReader, q: PersonFilesQuery): AttachmentItem[] =>
  attachmentPage(db, messagesByIds, { authorId: q.userId, limit: q.limit });
