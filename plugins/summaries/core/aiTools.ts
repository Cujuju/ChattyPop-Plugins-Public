// Stored recaps overlap the requested window; cited items require in-window visible sources.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveTool, type ArchiveToolLine, type ArchiveRead, clampToolScope, toolLimitField, toolScopeSql, parseToolArgs, toolResult, toolSchema, toolTimeFields, toolTime } from '@plugin-sdk/core';
import { pointCitations } from '../shared/types';
import { summaryPageSql, toSummary, type SummaryRow } from './summaryRows';

/** Default reads open three summaries; ten bounds expansion before the host line cap. */
const READ_DEFAULT = 3;
const READ_MAX = 10;
const fields = { ...toolTimeFields, limit: toolLimitField(READ_MAX) };

export function archiveTools(read: ArchiveRead): ArchiveTool[] {
  return [{
    name: 'read',
    description: 'Reads newest stored summaries whose channels are contained in the chat scope and whose spans overlap its window. Returns headlines and items whose cited messages are visible in that window.',
    parameters: toolSchema(fields),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseToolArgs<{ since?: string; until?: string; limit?: number }>(raw, fields);
      const window = clampToolScope(scope, args);
      const limit = args.limit ?? READ_DEFAULT;
      const page = summaryPageSql({ limit: limit + 1 }, window);
      const summaries = (await read<SummaryRow>(page.sql, page.params, { signal })).map(toSummary);
      signal.throwIfAborted();
      const selected = summaries.slice(0, limit);
      const ids = selected.flatMap((summary) => summary.items.flatMap(pointCitations).map((citation) => citation.messageId));
      const scoped = toolScopeSql(window);
      const rows = await read<{ id: string; channelId: string }>(`SELECT m.id, m.channel_id AS channelId FROM archive_messages m WHERE ${scoped.sql}
        AND m.id IN (SELECT value FROM json_each(?))`, [...scoped.params, JSON.stringify(ids)], { signal });
      const visible = new Map(rows.map((row) => [row.id, row.channelId]));
      signal.throwIfAborted();
      const entries: { line: ArchiveToolLine; channels: readonly string[] }[] = [];
      for (const summary of selected) {
        entries.push({ line: { text: `${summary.headline} | ${toolTime(summary.sinceTs)} – ${toolTime(summary.untilTs)}` }, channels: summary.channelIds });
        for (const item of summary.items) {
          const citations = pointCitations(item);
          if (citations.some((citation) => !visible.has(citation.messageId))) continue;
          entries.push({ line: { text: item.parts.map((part) => part.text).join(' '), ...(citations[0] ? { messageId: citations[0].messageId } : {}) },
            channels: [...summary.channelIds, ...citations.flatMap((citation) => [citation.channelId, visible.get(citation.messageId)!])] });
        }
      }
      const included = entries.slice(0, ARCHIVE_TOOL_LINES_MAX);
      return toolResult(included.map((entry) => entry.line), ARCHIVE_TOOL_LINES_MAX,
        [...new Set(included.flatMap((entry) => entry.channels))], summaries.length > limit || entries.length > included.length);
    },
  }];
}
