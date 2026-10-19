import type { AttachmentFilter } from '../shared/types';

/** Supported aggregate dimensions; range boundaries are selected before these weighted facts are filtered. */
export function aggregateWhere(f: AttachmentFilter): { sql: string; params: (string | number)[] } {
  const parts = ['1'];
  const params: (string | number)[] = [];
  const add = (sql: string, ...values: (string | number)[]) => { parts.push(sql); params.push(...values); };
  if (f.guildId !== undefined) add("COALESCE(c.guild_id, '') = ?", f.guildId);
  if (f.channelId !== undefined) add('(a.channel_id = ? OR a.channel_id IN (SELECT id FROM archive_channels WHERE is_thread = 1 AND parent_id = ?))', f.channelId, f.channelId);
  if (f.authorId !== undefined) add("COALESCE(a.author_id, '') = ?", f.authorId);
  if (f.kinds?.length) add(`a.kind IN (${f.kinds.map(() => '?').join(',')})`, ...f.kinds);
  if (f.presence === 'stored') parts.push('a.stored = 1');
  if (f.presence === 'gone') parts.push('a.stored = 0');
  if (f.uncompressed) parts.push('a.uncompressed = 1');
  return { sql: parts.join(' AND '), params };
}
