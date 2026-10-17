// Link searches use sharing messages rather than the link's global first share.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveTool, type PluginDb, clampToolScope, toolLimitField, toolScopeSql, parseToolArgs, toolResult, toolSchema, toolTextField, toolTimeFields, toolTime } from '@plugin-sdk/core';

/** Default searches return twenty shares; expanded reads use the host line budget. */
const SEARCH_DEFAULT = 20;
const SEARCH_MAX = ARCHIVE_TOOL_LINES_MAX;
const fields = {
  query: { ...toolTextField, description: 'Case-insensitive text in the title, URL or site.' },
  platform: { ...toolTextField, description: 'Exact stored platform name.' },
  author: { ...toolTextField, description: 'Author id or a case-insensitive part of the sharing author name.' },
  ...toolTimeFields, limit: toolLimitField(SEARCH_MAX),
};
interface Args { query?: string; platform?: string; author?: string; since?: string; until?: string; limit?: number }
interface Share { messageId: string; title: string | null; url: string; site: string | null; author: string; ts: number }

export function archiveTools(db: PluginDb): ArchiveTool[] {
  return [{
    name: 'search',
    description: 'Finds links shared in the chat scope and window, with title, URL, site, sharing author and timestamp. Use it to locate shared resources, including later shares of older links.',
    parameters: toolSchema(fields),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseToolArgs<Args>(raw, fields);
      const scoped = toolScopeSql(clampToolScope(scope, args));
      const parts = [scoped.sql];
      const params = scoped.params;
      if (args.query !== undefined) {
        parts.push("instr(lower(COALESCE(l.title, '') || ' ' || l.url || ' ' || COALESCE(l.site, '')), lower(?)) > 0");
        params.push(args.query);
      }
      if (args.platform !== undefined) { parts.push('l.platform = ?'); params.push(args.platform); }
      if (args.author !== undefined) {
        parts.push('(m.author_id = ? OR instr(lower(m.author_name), lower(?)) > 0)');
        params.push(args.author, args.author);
      }
      const limit = args.limit ?? SEARCH_DEFAULT;
      const rows = db.prepare(`SELECT m.id AS messageId, l.title, l.url, l.site, m.author_name AS author, m.ts
        FROM archive_message_links ml JOIN archive_messages m ON m.id = ml.message_id
        JOIN archive_links l ON l.id = ml.link_id WHERE ${parts.join(' AND ')}
        ORDER BY m.ts DESC, m.id DESC, l.id DESC LIMIT ?`).all(...params, limit + 1) as Share[];
      signal.throwIfAborted();
      return toolResult(rows.map((row) => ({ text: `${row.title ?? 'Untitled'} | ${row.url} | ${row.site ?? ''} | ${row.author} | ${toolTime(row.ts)}`, messageId: row.messageId })), limit);
    },
  }];
}
