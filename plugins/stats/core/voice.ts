import type { ArchiveRead } from '@plugin-sdk/core';
import { everyoneQuery, type ActivityQuery, type StatsPoster } from '../shared/types';
import { VOICE_PEOPLE, voiceShare, type VoiceStats } from '../shared/voice';
import { bucketForSpan, bucketStart, filledBuckets } from './histogram';
import { localDate } from './query';
import { personDays, type PersonDay } from './personDays';

/** One author/day grouping supplies scope totals and poster counts without reading message text. */
export async function voiceStats(read: ArchiveRead, query: ActivityQuery, supplied?: PersonDay[]): Promise<VoiceStats> {
  const days = supplied ?? await personDays(read, everyoneQuery(query));
  const rows = days.filter((row) => row.rangeCount > 0);
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  const posters = new Map<string, StatsPoster>();
  for (const row of rows) {
    firstTs = Math.min(firstTs ?? row.rangeFirstTs!, row.rangeFirstTs!);
    lastTs = Math.max(lastTs ?? row.rangeLastTs!, row.rangeLastTs!);
    const poster = posters.get(row.userId) ?? { userId: row.userId, name: row.name, avatar: row.avatar, count: 0 };
    poster.count += row.rangeCount;
    if (row.name < poster.name) poster.name = row.name;
    posters.set(row.userId, poster);
  }
  const bucket = bucketForSpan(firstTs === null ? null : query.sinceTs ?? firstTs, lastTs);
  const shown = query.authorId != null ? [...posters.values()].filter((p) => p.userId === query.authorId)
    : [...posters.values()].sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId)).slice(0, VOICE_PEOPLE);
  const totals = new Map<string, number>();
  const byPerson = new Map(shown.map((poster) => [poster.userId, new Map<string, number>()]));
  for (const row of rows) {
    const start = bucketStart(localDate(row.start), bucket);
    totals.set(start, (totals.get(start) ?? 0) + row.rangeCount);
    const counts = byPerson.get(row.userId);
    if (counts) counts.set(start, (counts.get(start) ?? 0) + row.rangeCount);
  }
  const buckets = filledBuckets(totals, bucket);
  const people = shown.map((poster) => ({ poster, counts: buckets.map(({ start }) => byPerson.get(poster.userId)!.get(start) ?? 0) }));
  let maxShare = 0;
  for (const person of people) for (const [index, count] of person.counts.entries()) {
    maxShare = Math.max(maxShare, voiceShare(count, buckets[index]!.count));
  }
  return { bucket, buckets, people, maxShare };
}
