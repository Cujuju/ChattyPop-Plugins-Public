// Scoped file metadata reads reuse the attachment feed's filters and author lookups.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveTool, type PluginDb } from '@plugin-sdk/core';
import { ATTACHMENT_FROM, AUTHOR_ID, AUTHOR_NAME, attachmentWhere } from './filters';
import type { AttachmentKind } from '../shared/types';
import { clampWindow, limitField, messageScope, parseArgs, result, schema, textField, timeFields } from './toolSupport';

/** Default reads return twenty files; expanded reads use the host line budget. */
const FILES_DEFAULT = 20;
const FILES_MAX = ARCHIVE_TOOL_LINES_MAX;
const fields = {
  name: { ...textField, description: 'Case-insensitive literal filename fragment.' },
  kind: { ...textField, enum: ['image', 'video', 'audio', 'file'] },
  author: { ...textField, description: 'Author id or a case-insensitive part of the author name.' },
  ...timeFields, limit: limitField(FILES_MAX),
};
interface Args { name?: string; kind?: AttachmentKind; author?: string; since?: number; until?: number; limit?: number }
interface FileRow { messageId: string; filename: string; kind: string; size: number | null; author: string | null; ts: number }

export function archiveTools(db: PluginDb): ArchiveTool[] {
  return [{
    name: 'files',
    description: 'Lists files attached to messages in the chat scope and window, with filename, kind, original byte size, author and timestamp. Use it to find shared images, videos, audio or documents.',
    parameters: schema(fields),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseArgs<Args>(raw, fields);
      const scoped = messageScope(clampWindow(scope, args));
      const where = attachmentWhere({ name: args.name, kinds: args.kind ? [args.kind] : undefined });
      const parts = [where.sql, `EXISTS (SELECT 1 FROM archive_messages m WHERE m.id = a.message_id AND ${scoped.sql})`];
      const params = [...where.params, ...scoped.params];
      if (args.author !== undefined) {
        parts.push(`(${AUTHOR_ID} = ? OR instr(lower(${AUTHOR_NAME}), lower(?)) > 0)`);
        params.push(args.author, args.author);
      }
      const limit = args.limit ?? FILES_DEFAULT;
      const rows = db.prepare(`SELECT a.message_id AS messageId, a.filename, a.kind, a.size, ${AUTHOR_NAME} AS author, a.ts
        ${ATTACHMENT_FROM} WHERE ${parts.join(' AND ')} ORDER BY a.ts DESC, a.id DESC LIMIT ?`)
        .all(...params, limit + 1) as FileRow[];
      signal.throwIfAborted();
      return result(rows.map((row) => ({ text: `${row.filename} | ${row.kind} | ${row.size === null ? 'unknown size' : `${row.size} bytes`} | ${row.author ?? 'Unknown author'} | ${new Date(row.ts).toISOString()}`, messageId: row.messageId })), limit);
    },
  }];
}
