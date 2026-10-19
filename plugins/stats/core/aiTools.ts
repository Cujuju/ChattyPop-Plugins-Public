// Exact-channel word rankings and AFINN sentiment reuse the maintained lexical summaries.
import { type ArchiveRead, type ArchiveTool, toolLimitField, parseToolArgs, toolResult, toolSchema, toolTextField } from '@plugin-sdk/core';
import { wordStats } from './words';
import { sentimentStats } from './sentiment';
import { projectCounts } from './countRead';
import type { StatsRollups } from './rollups';
import type { StatsPoster } from '../shared/types';
import type { ChannelListQuery } from './query';

/** Default rankings contain fifteen words; thirty bounds rankings below the host line budget after sentiment. */
const WORDS_DEFAULT = 15;
const WORDS_MAX = 30;
const fields = {
  author: { ...toolTextField, description: 'Author id or a case-insensitive part of the author name.' },
  limit: toolLimitField(WORDS_MAX),
};

/** Author lookups, aggregates and bounded message pages use the off-thread reader. */
export function archiveTools(read: ArchiveRead, rollups?: StatsRollups): ArchiveTool[] {
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
      const candidates = args.author === undefined ? [] : await projectCounts<(StatsPoster & { aliases: string[] })[]>(read, query, 'identityCandidates', rollups, signal);
      const authors = args.author === undefined ? [null] : candidates.filter((p) => p.userId === args.author || [p.name, ...p.aliases].some((name) => name.toLowerCase().includes(args.author!.toLowerCase()))).map((p) => p.userId);
      if (authors.length > 1) throw new Error('Author matches multiple people; use an author id.');
      if (!authors.length) return toolResult([], undefined, scope.channelIds);
      query.authorId = authors[0];
      signal.throwIfAborted();
      const words = await wordStats(read, query, signal, rollups);
      const sentiment = await sentimentStats(read, query, signal, rollups);
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
