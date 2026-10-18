// Plans and decisions from messages permitted by the caller's exact scope.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveRead, type ArchiveTool, toolLimitField, parseToolArgs, toolResult, toolSchema, toolTime } from '@plugin-sdk/core';
import { planItems, planListSql, type PlanRow } from './plans';

/** Default reads return twenty entries; expanded reads use the host line budget. */
const PLANS_DEFAULT = 20;
const PLANS_MAX = ARCHIVE_TOOL_LINES_MAX;
const fields = {
  upcoming: { type: 'boolean' as const, description: 'Defaults to true: omit past dated plans, retaining undated plans and decisions.' },
  limit: toolLimitField(PLANS_MAX),
};

/** `redact` reads current privacy after each query, so names hidden meanwhile stay hidden. */
export function archiveTools(read: ArchiveRead, redact: () => (text: string) => string): ArchiveTool[] {
  return [{
    name: 'list',
    description: 'Lists extracted plans and decisions from messages in the chat scope and window, with title, event time and named participants. Use it to review commitments or decisions; upcoming defaults to true.',
    parameters: toolSchema(fields),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseToolArgs<{ upcoming?: boolean; limit?: number }>(raw, fields);
      const limit = args.limit ?? PLANS_DEFAULT;
      const query = planListSql(limit + 1, scope, args.upcoming ?? true);
      const rows = planItems(await read<PlanRow>(query.sql, query.params, { signal }), redact());
      signal.throwIfAborted();
      const included = rows.slice(0, limit);
      return toolResult(included.map((row) => ({ text: `${row.kind}: ${row.title} | ${row.whenTs === null ? 'Undated' : toolTime(row.whenTs)} | ${row.who.join(', ')}`, messageId: row.messageId })),
        limit, [...new Set(included.map((row) => row.channelId))], rows.length > limit);
    },
  }];
}
