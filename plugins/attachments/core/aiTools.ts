// Scoped file metadata reads reuse the attachment feed's filters and author lookups.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveRead, type ArchiveTool, clampToolScope, toolLimitField, toolScopeSql, parseToolArgs, toolResult, toolSchema, toolTextField, toolTimeFields, toolTime } from '@plugin-sdk/core';
import { ATTACHMENT_FROM, AUTHOR_ID, AUTHOR_NAME, attachmentWhere } from './filters';
import type { AttachmentKind } from '../shared/types';

/** Default reads return twenty files; expanded reads use the host line budget. */
const FILES_DEFAULT = 20;
const FILES_MAX = ARCHIVE_TOOL_LINES_MAX;
const fields = {
  name: { ...toolTextField, description: 'Case-insensitive literal filename fragment.' },
  kind: { ...toolTextField, enum: ['image', 'video', 'audio', 'file'] },
  author: { ...toolTextField, description: 'Author id or a case-insensitive part of the author name.' },
  ...toolTimeFields, limit: toolLimitField(FILES_MAX),
};
interface Args { name?: string; kind?: AttachmentKind; author?: string; since?: string; until?: string; limit?: number }
interface FileRow { messageId: string; channelId: string; filename: string; kind: string; size: number | null; author: string | null; ts: number }

export function archiveTools(read: ArchiveRead): ArchiveTool[] {
  return [{
    name: 'files',
    description: 'Lists files attached to messages in the chat scope and window, with filename, kind, original byte size, author and timestamp. Use it to find shared images, videos, audio or documents.',
    parameters: toolSchema(fields),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseToolArgs<Args>(raw, fields);
      const scoped = toolScopeSql(clampToolScope(scope, args));
      const where = attachmentWhere({ name: args.name, kinds: args.kind ? [args.kind] : undefined });
      const parts = [where.sql, `EXISTS (SELECT 1 FROM archive_messages m WHERE m.id = a.message_id AND ${scoped.sql})`];
      const params = [...where.params, ...scoped.params];
      if (args.author !== undefined) {
        parts.push(`(${AUTHOR_ID} = ? OR instr(lower(${AUTHOR_NAME}), lower(?)) > 0)`);
        params.push(args.author, args.author);
      }
      const limit = args.limit ?? FILES_DEFAULT;
      const rows = await read<FileRow>(`SELECT a.message_id AS messageId, a.channel_id AS channelId, a.filename, a.kind, a.size, ${AUTHOR_NAME} AS author, a.ts
        ${ATTACHMENT_FROM} WHERE ${parts.join(' AND ')} ORDER BY a.ts DESC, a.id DESC LIMIT ?`,
        [...params, limit + 1], { signal });
      signal.throwIfAborted();
      const included = rows.slice(0, limit);
      return toolResult(included.map((row) => ({ text: `${row.filename} | ${row.kind} | ${row.size === null ? 'unknown size' : `${row.size} bytes`} | ${row.author ?? 'Unknown author'} | ${toolTime(row.ts)}`, messageId: row.messageId })),
        limit, [...new Set(included.map((row) => row.channelId))], rows.length > limit);
    },
  }];
}
