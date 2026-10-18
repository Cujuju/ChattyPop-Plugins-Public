// Scoped tag counts and tagged message reads for AI chat.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveRead, type ArchiveTool, toolLimitField, parseToolArgs, toolResult, toolSchema, toolTextField, toolTime, type ArchiveToolScope } from '@plugin-sdk/core';
import { tagListSql, taggedSql, toTag, type CountedTagRow } from './store';
import type { TaggedMessage } from '../shared/types';

/** Default reads open twenty messages; expanded reads use the host line budget. */
const MESSAGES_DEFAULT = 20;
const MESSAGES_MAX = ARCHIVE_TOOL_LINES_MAX;
const fields = { tag: { ...toolTextField, description: 'Exact tag name, case insensitive.' }, limit: toolLimitField(MESSAGES_MAX) };

export function archiveTools(read: ArchiveRead): ArchiveTool[] {
  const tags = async (scope: ArchiveToolScope, signal: AbortSignal) => {
    const query = tagListSql(scope);
    return (await read<CountedTagRow>(query.sql, query.params, { signal })).map(toTag).filter((tag) => tag.count > 0);
  };
  return [{
    name: 'list',
    description: 'Lists tags applied to messages in the chat scope and window, with message counts. Use it to discover tag names before reading tagged messages.',
    parameters: toolSchema({}),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      parseToolArgs(raw, {});
      const listed = await tags(scope, signal);
      return toolResult(listed.map((tag) => ({ text: `${tag.name}: ${tag.count} messages` })), ARCHIVE_TOOL_LINES_MAX, scope.channelIds);
    },
  }, {
    name: 'messages',
    description: 'Returns the newest messages carrying a named tag in the chat scope and window. Use it to inspect the messages behind a tag.',
    parameters: toolSchema(fields, ['tag']),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseToolArgs<{ tag: string; limit?: number }>(raw, fields, ['tag']);
      const tag = (await tags(scope, signal)).find((tag) => tag.name.toLowerCase() === args.tag.trim().toLowerCase());
      const limit = args.limit ?? MESSAGES_DEFAULT;
      const query = tag && taggedSql(tag.id, limit + 1, scope);
      const rows = query ? await read<TaggedMessage>(query.sql, query.params, { signal }) : [];
      const included = rows.slice(0, limit);
      return toolResult(included.map((row) => ({ text: `${row.author} | ${toolTime(row.ts)} | ${row.content}`, messageId: row.messageId })),
        limit, [...new Set(included.map((row) => row.channelId))], rows.length > limit);
    },
  }];
}
