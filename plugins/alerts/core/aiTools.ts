// The scoped alert inbox contribution to AI chat.
import { ARCHIVE_TOOL_LINES_MAX, type ArchivePayloadReader, type ArchiveTool, type PluginDb } from '@plugin-sdk/core';
import { alertItems } from './queries';
import { limitField, parseArgs, result, schema, textField } from './toolSupport';

/** Default reads return twenty alerts; expanded reads use the host line budget. */
const ALERTS_DEFAULT = 20;
const ALERTS_MAX = ARCHIVE_TOOL_LINES_MAX;
const fields = {
  rule: { ...textField, description: 'Rule id or a case-insensitive part of its name.' },
  unread: { type: 'boolean' as const, description: 'True selects unread alerts; false selects read alerts; omitted selects both.' },
  limit: limitField(ALERTS_MAX),
};

export function archiveTools(db: PluginDb, payloads: ArchivePayloadReader): ArchiveTool[] {
  return [{
    name: 'list',
    description: 'Lists matching alerts in the chat scope and window, with their rule, timestamp and snippet. Use it to find messages that triggered inbox rules.',
    parameters: schema(fields),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseArgs<{ rule?: string; unread?: boolean; limit?: number }>(raw, fields);
      const limit = args.limit ?? ALERTS_DEFAULT;
      const rows = alertItems(db, payloads, { limit: limit + 1 }, undefined, { scope, ...args });
      signal.throwIfAborted();
      return result(rows.map((row) => ({ text: `${row.sourceName} | ${new Date(row.ts).toISOString()} | ${row.snippet}`, messageId: row.messageId })), limit);
    },
  }];
}
