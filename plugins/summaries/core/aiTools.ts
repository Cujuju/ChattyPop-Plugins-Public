// Stored recaps overlap the requested window; cited items require in-window visible sources.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveTool, type ArchiveToolLine, type PluginDb } from '@plugin-sdk/core';
import { pointCitations } from '../shared/types';
import { summaryPage } from './summaryRows';
import { clampWindow, limitField, messageScope, parseArgs, result, schema, timeFields } from './toolSupport';

/** Default reads open three summaries; ten bounds expansion before the host line cap. */
const READ_DEFAULT = 3;
const READ_MAX = 10;
const fields = { ...timeFields, limit: limitField(READ_MAX) };

export function archiveTools(db: PluginDb): ArchiveTool[] {
  return [{
    name: 'read',
    description: 'Reads newest stored summaries whose channels are contained in the chat scope and whose spans overlap its window. Returns headlines and items whose cited messages are visible in that window.',
    parameters: schema(fields),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseArgs<{ since?: number; until?: number; limit?: number }>(raw, fields);
      const window = clampWindow(scope, args);
      const limit = args.limit ?? READ_DEFAULT;
      const summaries = summaryPage(db, { limit: limit + 1 }, window);
      signal.throwIfAborted();
      const selected = summaries.slice(0, limit);
      const ids = selected.flatMap((summary) => summary.items.flatMap(pointCitations).map((citation) => citation.messageId));
      const scoped = messageScope(window);
      const visible = new Set(db.prepare(`SELECT m.id FROM archive_messages m WHERE ${scoped.sql}
        AND m.id IN (SELECT value FROM json_each(?))`).pluck().all(...scoped.params, JSON.stringify(ids)) as string[]);
      signal.throwIfAborted();
      const lines: ArchiveToolLine[] = [];
      for (const summary of selected) {
        lines.push({ text: `${summary.headline} | ${new Date(summary.sinceTs).toISOString()} – ${new Date(summary.untilTs).toISOString()}` });
        for (const item of summary.items) {
          const citations = pointCitations(item);
          if (citations.some((citation) => !visible.has(citation.messageId))) continue;
          lines.push({ text: item.parts.map((part) => part.text).join(' '), ...(citations[0] ? { messageId: citations[0].messageId } : {}) });
        }
      }
      return result(lines, ARCHIVE_TOOL_LINES_MAX, [...new Set(selected.flatMap((summary) => summary.channelIds))], summaries.length > limit);
    },
  }];
}
