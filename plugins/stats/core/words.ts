import type { PluginDb } from '@plugin-sdk/core';
import { en } from 'stopwords-iso/stopwords-iso.json';
import type { ActivityQuery } from '../shared/types';
import { CLOUD_WORDS, MIN_WORD_LENGTH, type WordStats } from '../shared/text';
import { scanText } from './scan';
import { tokenize } from './tokenize';
import { createMessageLengths } from './messageLength';
import { createWordTrends } from './wordTrends';
import { bucketForSpan } from './histogram';
import { attachPosterIdentities, readPosterIdentities, scopeSql } from './stats';
import { rankedTop } from './rankedTop';

const STOP_WORDS = new Set(en);
const eligibleWord = (word: string): boolean => Array.from(word).length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word);

export async function wordStats(db: PluginDb, query: ActivityQuery): Promise<WordStats> {
  const scope = scopeSql(db, query);
  const extent = db.prepare(`SELECT MIN(m.ts) AS firstTs, MAX(m.ts) AS lastTs FROM archive_messages m WHERE ${scope.sql}`)
    .get(...scope.params) as { firstTs: number | null; lastTs: number | null };
  const bucket = bucketForSpan(extent.firstTs === null ? null : query.sinceTs ?? extent.firstTs, extent.lastTs);
  const trends = createWordTrends(bucket, eligibleWord);
  const counts = new Map<string, { count: number; seq: number; position: number }>();
  const lengths = createMessageLengths();
  let totalWords = 0;
  const textMessages = await scanText(db, query, (message) => {
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
  });
  const words = rankedTop([...counts].filter(([word]) => eligibleWord(word)).map(([word, { count }]) => ({ word, count })), CLOUD_WORDS,
    (a, b) => b.count - a.count || a.word.localeCompare(b.word) || counts.get(a.word)!.seq - counts.get(b.word)!.seq
      || counts.get(a.word)!.position - counts.get(b.word)!.position);
  const length = lengths.finish(textMessages);
  const identities = readPosterIdentities(db, scope, [...length.people, ...length.longest].map((person) => person.userId));
  return { textMessages, totalWords, uniqueWords: counts.size, wordsPerMessage: textMessages ? totalWords / textMessages : 0,
    words, length: { ...length, people: attachPosterIdentities(length.people, identities), longest: attachPosterIdentities(length.longest, identities) },
    trends: await trends.finish(words) };
}
