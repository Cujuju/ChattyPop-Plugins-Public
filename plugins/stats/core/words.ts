import type { ArchiveRead } from '@plugin-sdk/core';
import { en } from 'stopwords-iso/stopwords-iso.json';
import type { TextQuery } from './query';
import { CLOUD_WORDS, MIN_WORD_LENGTH, type WordStats } from '../shared/text';
import type { StatsIdentity } from '../shared/types';
import { scanText } from './scan';
import { tokenize } from './tokenize';
import { createMessageLengths } from './messageLength';
import { createWordTrends } from './wordTrends';
import { bucketForSpan } from './histogram';
import { attachPosterIdentities, posterIdentitiesSql, scopeSql } from './stats';
import { rankedTop } from './rankedTop';

const STOP_WORDS = new Set(en);
const eligibleWord = (word: string): boolean => Array.from(word).length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word);

/** Aggregates and keyset scan batches use the committed off-thread reader. */
export async function wordStats(read: ArchiveRead, query: TextQuery, signal?: AbortSignal): Promise<WordStats> {
  signal?.throwIfAborted();
  const scope = (await scopeSql(read, query));
  // An aggregate without GROUP BY returns exactly one row.
  const extent = (await read<{ firstTs: number | null; lastTs: number | null }>(`SELECT MIN(m.ts) AS firstTs, MAX(m.ts) AS lastTs FROM archive_messages m WHERE ${scope.sql}`,
    scope.params, { signal }))[0]!;
  const bucket = bucketForSpan(extent.firstTs === null ? null : query.sinceTs ?? extent.firstTs, extent.lastTs);
  const trends = createWordTrends(bucket, eligibleWord);
  const counts = new Map<string, { count: number; seq: number; position: number }>();
  const lengths = createMessageLengths();
  let totalWords = 0;
  const textMessages = await scanText(read, query, (message) => {
    const tokens = tokenize(message.content);
    lengths.read(message, tokens.length);
    trends.read(message.ts, tokens, message.seq);
    for (let position = 0; position < tokens.length; position++) {
      const word = tokens[position]!;
      totalWords++;
      const count = counts.get(word) ?? { count: 0, seq: message.seq, position };
      count.count++;
      if (message.seq < count.seq) { count.seq = message.seq; count.position = position; }
      counts.set(word, count);
    }
  }, signal);
  const words = rankedTop([...counts].filter(([word]) => eligibleWord(word)).map(([word, { count }]) => ({ word, count })), CLOUD_WORDS,
    (a, b) => b.count - a.count || a.word.localeCompare(b.word) || counts.get(a.word)!.seq - counts.get(b.word)!.seq
      || counts.get(a.word)!.position - counts.get(b.word)!.position);
  const length = lengths.finish(textMessages);
  const people = posterIdentitiesSql(scope, [...length.people, ...length.longest].map((person) => person.userId));
  const identities = people ? await read<StatsIdentity>(people.sql, people.params, { signal }) : [];
  return { textMessages, totalWords, uniqueWords: counts.size, wordsPerMessage: textMessages ? totalWords / textMessages : 0,
    words, length: { ...length, people: attachPosterIdentities(length.people, identities), longest: attachPosterIdentities(length.longest, identities) },
    trends: await trends.finish(words) };
}
