// Scoped tag counts and tagged message reads for AI chat.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveTool, type PluginDb, toolLimitField, parseToolArgs, toolResult, toolSchema, toolTextField, toolTime } from '@plugin-sdk/core';
import { TagStore } from './store';

/** Default reads open twenty messages; expanded reads use the host line budget. */
const MESSAGES_DEFAULT = 20;
const MESSAGES_MAX = ARCHIVE_TOOL_LINES_MAX;
const fields = { tag: { ...toolTextField, description: 'Exact tag name, case insensitive.' }, limit: toolLimitField(MESSAGES_MAX) };

export function archiveTools(db: PluginDb): ArchiveTool[] {
  const store = new TagStore(db);
  return [{
    name: 'list',
    description: 'Lists tags applied to messages in the chat scope and window, with message counts. Use it to discover tag names before reading tagged messages.',
    parameters: toolSchema({}),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      parseToolArgs(raw, {});
      const tags = store.list(scope).filter((tag) => tag.count > 0);
      signal.throwIfAborted();
      return toolResult(tags.map((tag) => ({ text: `${tag.name}: ${tag.count} messages` })), ARCHIVE_TOOL_LINES_MAX, scope.channelIds);
    },
  }, {
    name: 'messages',
    description: 'Returns the newest messages carrying a named tag in the chat scope and window. Use it to inspect the messages behind a tag.',
    parameters: toolSchema(fields, ['tag']),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseToolArgs<{ tag: string; limit?: number }>(raw, fields, ['tag']);
      const tag = store.list(scope).find((tag) => tag.count > 0 && tag.name.toLowerCase() === args.tag.trim().toLowerCase());
      signal.throwIfAborted();
      const limit = args.limit ?? MESSAGES_DEFAULT;
      const rows = tag ? store.tagged(tag.id, limit + 1, scope) : [];
      signal.throwIfAborted();
      return toolResult(rows.map((row) => ({ text: `${row.author} | ${toolTime(row.ts)} | ${row.content}`, messageId: row.messageId })), limit);
    },
  }];
}
