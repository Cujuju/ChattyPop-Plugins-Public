import type { PluginDb } from '@plugin-sdk/core';
import type { ActivityQuery, StatsPoster } from '../shared/types';
import { VOICE_PEOPLE, voiceShare, type VoiceStats } from '../shared/voice';
import { bucketForSpan, bucketStart, filledBuckets } from './histogram';
import { local, localDate } from './query';
import { scopeSql } from './stats';

interface PersonDay extends StatsPoster { start: string; firstTs: number; lastTs: number }

/** One author/day grouping supplies scope totals and poster counts without reading message text. */
export function voiceStats(db: PluginDb, query: ActivityQuery): VoiceStats {
  const scope = scopeSql(db, query);
  const rows = db.prepare(`SELECT m.author_id AS userId, MIN(m.author_plain_name) AS name, u.avatar AS avatar,
    date(${local('m.ts')}) AS start, MIN(m.ts) AS firstTs, MAX(m.ts) AS lastTs, COUNT(*) AS count
    FROM archive_messages m LEFT JOIN archive_users u ON u.id = m.author_id
    WHERE ${scope.sql} GROUP BY m.author_id, start ORDER BY userId, start`).all(...scope.params) as PersonDay[];
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  const posters = new Map<string, StatsPoster>();
  for (const row of rows) {
    firstTs = Math.min(firstTs ?? row.firstTs, row.firstTs);
    lastTs = Math.max(lastTs ?? row.lastTs, row.lastTs);
    const poster = posters.get(row.userId) ?? { userId: row.userId, name: row.name, avatar: row.avatar, count: 0 };
    poster.count += row.count;
    if (row.name < poster.name) poster.name = row.name;
    posters.set(row.userId, poster);
  }
  const bucket = bucketForSpan(firstTs === null ? null : query.sinceTs ?? firstTs, lastTs);
  const shown = [...posters.values()].sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId)).slice(0, VOICE_PEOPLE);
  const totals = new Map<string, number>();
  const byPerson = new Map(shown.map((poster) => [poster.userId, new Map<string, number>()]));
  for (const row of rows) {
    const start = bucketStart(localDate(row.start), bucket);
    totals.set(start, (totals.get(start) ?? 0) + row.count);
    const counts = byPerson.get(row.userId);
    if (counts) counts.set(start, (counts.get(start) ?? 0) + row.count);
  }
  const buckets = filledBuckets(totals, bucket);
  const people = shown.map((poster) => ({ poster, counts: buckets.map(({ start }) => byPerson.get(poster.userId)!.get(start) ?? 0) }));
  let maxShare = 0;
  for (const person of people) for (const [index, count] of person.counts.entries()) {
    maxShare = Math.max(maxShare, voiceShare(count, buckets[index]!.count));
  }
  return { bucket, buckets, people, maxShare };
}
