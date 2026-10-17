// Scoped tag counts and tagged message reads for AI chat.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveTool, type PluginDb } from '@plugin-sdk/core';
import { TagStore } from './store';
import { limitField, parseArgs, result, schema, textField } from './toolSupport';

/** Default reads open twenty messages; expanded reads use the host line budget. */
const MESSAGES_DEFAULT = 20;
const MESSAGES_MAX = ARCHIVE_TOOL_LINES_MAX;
const fields = { tag: { ...textField, description: 'Exact tag name, case insensitive.' }, limit: limitField(MESSAGES_MAX) };

export function archiveTools(db: PluginDb): ArchiveTool[] {
  const store = new TagStore(db);
  return [{
    name: 'list',
    description: 'Lists tags applied to messages in the chat scope and window, with message counts. Use it to discover tag names before reading tagged messages.',
    parameters: schema({}),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      parseArgs(raw, {});
      const tags = store.list(scope).filter((tag) => tag.count > 0);
      signal.throwIfAborted();
      return result(tags.map((tag) => ({ text: `${tag.name}: ${tag.count} messages` })), ARCHIVE_TOOL_LINES_MAX, scope.channelIds);
    },
  }, {
    name: 'messages',
    description: 'Returns the newest messages carrying a named tag in the chat scope and window. Use it to inspect the messages behind a tag.',
    parameters: schema(fields, ['tag']),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseArgs<{ tag: string; limit?: number }>(raw, fields, ['tag']);
      const tag = store.list(scope).find((tag) => tag.count > 0 && tag.name.toLowerCase() === args.tag.trim().toLowerCase());
      signal.throwIfAborted();
      const limit = args.limit ?? MESSAGES_DEFAULT;
      const rows = tag ? store.tagged(tag.id, limit + 1, scope) : [];
      signal.throwIfAborted();
      return result(rows.map((row) => ({ text: `${row.author} | ${new Date(row.ts).toISOString()} | ${row.content}`, messageId: row.messageId })), limit);
    },
  }];
}
