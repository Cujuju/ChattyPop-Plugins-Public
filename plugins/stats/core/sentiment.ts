import type { ArchiveRead, PluginDb } from '@plugin-sdk/core';
import { afinn165 } from 'afinn-165';
import type { TextQuery } from './query';
import type { SentimentStats } from '../shared/text';
import { bucketForSpan, bucketStart, filledBuckets } from './histogram';
import { scanText } from './scan';
import { scopeSql, syncRead } from './stats';
import { tokenize } from './tokenize';

/** `read` runs the whole-scope aggregates; the message scan stays in bounded `db` batches. */
export async function sentimentStats(db: PluginDb, query: TextQuery, signal?: AbortSignal, read: ArchiveRead = syncRead(db)): Promise<SentimentStats> {
  signal?.throwIfAborted();
  const scope = scopeSql(db, query);
  // An aggregate without GROUP BY returns exactly one row.
  const extent = (await read<{ firstTs: number | null; lastTs: number | null }>(`SELECT MIN(m.ts) AS firstTs, MAX(m.ts) AS lastTs FROM archive_messages m WHERE ${scope.sql}`,
    scope.params, { signal }))[0]!;
  const bucket = bucketForSpan(extent.firstTs === null ? null : query.sinceTs ?? extent.firstTs, extent.lastTs);
  const classes = { positive: 0, negative: 0, neutral: 0 };
  const counts = new Map<string, SentimentStats['buckets'][number]>();
  const textMessages = await scanText(db, query, ({ content, ts }) => {
    const score = tokenize(content).reduce((sum, word) => sum + (Object.hasOwn(afinn165, word) ? afinn165[word]! : 0), 0);
    const sentiment = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
    classes[sentiment]++;
    const start = bucketStart(new Date(ts), bucket);
    const counted = counts.get(start) ?? { start, positive: 0, negative: 0, messages: 0 };
    counted.messages++;
    if (sentiment !== 'neutral') counted[sentiment]++;
    counts.set(start, counted);
  }, signal, read);
  const buckets = filledBuckets(new Map([...counts].map(([start, counted]) => [start, counted.messages])), bucket)
    .map(({ start }) => counts.get(start) ?? { start, positive: 0, negative: 0, messages: 0 });
  return { textMessages, classes, bucket, buckets };
}
