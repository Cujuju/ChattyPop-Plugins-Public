// The scoped alert inbox contribution to AI chat.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveRead, type ArchiveTool, toolLimitField, parseToolArgs, toolResult, toolSchema, toolTextField, toolTime } from '@plugin-sdk/core';
import { alertsSql } from './queries';
import type { AlertItem } from '../shared/types';

/** Default reads return twenty alerts; expanded reads use the host line budget. */
const ALERTS_DEFAULT = 20;
const ALERTS_MAX = ARCHIVE_TOOL_LINES_MAX;
const fields = {
  rule: { ...toolTextField, description: 'Rule id or a case-insensitive part of its name.' },
  unread: { type: 'boolean' as const, description: 'True selects unread alerts; false selects read alerts; omitted selects both.' },
  limit: toolLimitField(ALERTS_MAX),
};

export function archiveTools(read: ArchiveRead): ArchiveTool[] {
  return [{
    name: 'list',
    description: 'Lists matching alerts in the chat scope and window, with their rule, timestamp and snippet. Use it to find messages that triggered inbox rules.',
    parameters: toolSchema(fields),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseToolArgs<{ rule?: string; unread?: boolean; limit?: number }>(raw, fields);
      const limit = args.limit ?? ALERTS_DEFAULT;
      const query = alertsSql({ limit: limit + 1 }, undefined, { scope, ...args });
      const rows = await read<Pick<AlertItem, 'sourceName' | 'ts' | 'snippet' | 'messageId' | 'channelId'>>(query.sql, query.params, { signal });
      signal.throwIfAborted();
      const included = rows.slice(0, limit);
      return toolResult(included.map((row) => ({ text: `${row.sourceName} | ${toolTime(row.ts)} | ${row.snippet}`, messageId: row.messageId })),
        limit, [...new Set(included.map((row) => row.channelId))], rows.length > limit);
    },
  }];
}
