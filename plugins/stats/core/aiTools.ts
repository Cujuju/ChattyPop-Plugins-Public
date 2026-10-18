// Exact-channel word rankings and AFINN sentiment reuse the Activity scanners.
import { type ArchiveRead, type ArchiveTool, type PluginDb, toolLimitField, toolScopeSql, parseToolArgs, toolResult, toolSchema, toolTextField } from '@plugin-sdk/core';
import { wordStats } from './words';
import { sentimentStats } from './sentiment';
import type { ChannelListQuery } from './query';

/** Default rankings contain fifteen words; thirty bounds rankings below the host line budget after sentiment. */
const WORDS_DEFAULT = 15;
const WORDS_MAX = 30;
const fields = {
  author: { ...toolTextField, description: 'Author id or a case-insensitive part of the author name.' },
  limit: toolLimitField(WORDS_MAX),
};

/** `read` runs the unbounded author lookup off the core thread; the scanners use `db` in bounded batches that check the signal between them. */
export function archiveTools(read: ArchiveRead, db: PluginDb): ArchiveTool[] {
  return [{
    name: 'words',
    description: 'Returns top words with English stopwords removed and AFINN positive, negative and neutral message counts over the chat scope and window. Use it for topics and lexical sentiment, which does not detect sarcasm.',
    parameters: toolSchema(fields),
    async run(raw, scope, signal) {
      signal.throwIfAborted();
      const args = parseToolArgs<{ author?: string; limit?: number }>(raw, fields);
      if (!scope.channelIds.length) return toolResult([], undefined, []);
      const query: ChannelListQuery = { scope: 'channels', channelIds: scope.channelIds, sinceTs: scope.since, untilTs: scope.until };
      // Resolve names only from messages inside the caller's scope and window.
      const scoped = toolScopeSql(scope);
      const authors = args.author === undefined ? [null] : (await read<{ authorId: string }>(`SELECT DISTINCT m.author_id AS authorId FROM archive_messages m
        WHERE ${scoped.sql} AND (m.author_id = ? OR instr(lower(m.author_name), lower(?)) > 0)`,
        [...scoped.params, args.author, args.author], { signal })).map((row) => row.authorId);
      if (authors.length > 1) throw new Error('Author matches multiple people; use an author id.');
      if (!authors.length) return toolResult([], undefined, scope.channelIds);
      query.authorId = authors[0];
      signal.throwIfAborted();
      const words = await wordStats(db, query, signal);
      const sentiment = await sentimentStats(db, query, signal);
      signal.throwIfAborted();
      const limit = args.limit ?? WORDS_DEFAULT;
      const lines = [
        { text: `AFINN sentiment: ${sentiment.classes.positive} positive, ${sentiment.classes.negative} negative, ${sentiment.classes.neutral} neutral (${sentiment.textMessages} text messages).` },
        ...words.words.slice(0, limit).map((word) => ({ text: `${word.word}: ${word.count}` })),
      ];
      // Every scoped channel contributes to word and sentiment totals, including zero counts.
      return toolResult(lines, undefined, scope.channelIds, words.words.length > limit);
    },
  }];
}
