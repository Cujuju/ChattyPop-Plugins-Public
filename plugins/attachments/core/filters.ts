import type { AttachmentFilter } from '../shared/types';

const ON_DISK = "a.status = 'stored' AND a.sha256 IS NOT NULL";
/** What largest orders by and a tile shows: bytes on this PC, else Discord's size. A freed file's old stored size is ignored. */
export const SIZE_KEY = `COALESCE(CASE WHEN ${ON_DISK} THEN a.stored_bytes END, a.size, 0)`;
export const DISK_BYTES = `CASE WHEN ${ON_DISK} THEN ${SIZE_KEY} ELSE 0 END`;
/**
 * A file's message author, looked up per row by the message's key. archive_messages is a joined view: SQLite can't flatten
 * it under a LEFT JOIN, so joining it would materialize every archived message on each query.
 */
export const messageColumn = (column: string, messageId = 'a.message_id'): string => `(SELECT ${column} FROM archive_messages WHERE id = ${messageId})`;
export const AUTHOR_ID = messageColumn('author_id');
export const AUTHOR_NAME = messageColumn('author_name');
/** Stop at the first other visible posting; counting every duplicate per matched row would be quadratic. */
const REPEATED = 'EXISTS (SELECT 1 FROM archive_attachments posting WHERE posting.sha256 = a.sha256 AND posting.id != a.id)';
export const ATTACHMENT_FROM = `FROM archive_attachments a
  LEFT JOIN archive_channels c ON c.id = a.channel_id
  LEFT JOIN archive_guilds g ON g.id = c.guild_id`;

/** Filter values remain bound, including LIKE metacharacters and channel thread scope. */
export function attachmentWhere(f: AttachmentFilter): { sql: string; params: (string | number)[] } {
  const parts = ['1'];
  const params: (string | number)[] = [];
  const add = (sql: string, ...values: (string | number)[]): void => { parts.push(sql); params.push(...values); };
  if (f.guildId !== undefined) add("COALESCE(c.guild_id, '') = ?", f.guildId);
  if (f.channelId !== undefined) add('(a.channel_id = ? OR a.channel_id IN (SELECT id FROM archive_channels WHERE is_thread = 1 AND parent_id = ?))', f.channelId, f.channelId);
  if (f.authorId !== undefined) add(`COALESCE(${AUTHOR_ID}, '') = ?`, f.authorId);
  if (f.kinds?.length) add(`a.kind IN (${f.kinds.map(() => '?').join(',')})`, ...f.kinds);
  if (f.sinceTs !== undefined) add('a.ts > ?', f.sinceTs);
  if (f.untilTs !== undefined) add('a.ts <= ?', f.untilTs);
  if (f.minBytes !== undefined) add(`${SIZE_KEY} >= ?`, f.minBytes);
  if (f.presence === 'stored') parts.push(ON_DISK);
  if (f.presence === 'gone') parts.push(`NOT (${ON_DISK})`);
  if (f.uncompressed) parts.push(`${ON_DISK} AND a.kind IN ('image', 'video') AND a.compressed_at IS NULL`);
  if (f.repeated) parts.push(`a.sha256 IS NOT NULL AND ${REPEATED}`);
  if (f.name) add("a.filename LIKE ? ESCAPE '\\'", `%${f.name.replace(/[\\%_]/g, '\\$&')}%`);
  return { sql: parts.join(' AND '), params };
}
