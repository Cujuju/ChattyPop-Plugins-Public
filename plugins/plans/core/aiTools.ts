// Plans and decisions from messages permitted by the caller's exact scope.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveTool, type PluginDb, toolLimitField, parseToolArgs, toolResult, toolSchema, toolTime } from '@plugin-sdk/core';
import { planList } from './plans';

/** Default reads return twenty entries; expanded reads use the host line budget. */
const PLANS_DEFAULT = 20;
const PLANS_MAX = ARCHIVE_TOOL_LINES_MAX;
const fields = {
  upcoming: { type: 'boolean' as const, description: 'Defaults to true: omit past dated plans, retaining undated plans and decisions.' },
  limit: toolLimitField(PLANS_MAX),
};

export function archiveTools(db: PluginDb): ArchiveTool[] {
  return [{
    name: 'list',
    description: 'Lists extracted plans and decisions from messages in the chat scope and window, with title, event time and named participants. Use it to review commitments or decisions; upcoming defaults to true.',
    parameters: toolSchema(fields),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseToolArgs<{ upcoming?: boolean; limit?: number }>(raw, fields);
      const limit = args.limit ?? PLANS_DEFAULT;
      const rows = planList(db, limit + 1, scope, args.upcoming ?? true);
      signal.throwIfAborted();
      return toolResult(rows.map((row) => ({ text: `${row.kind}: ${row.title} | ${row.whenTs === null ? 'Undated' : toolTime(row.whenTs)} | ${row.who.join(', ')}`, messageId: row.messageId })), limit);
    },
  }];
}
