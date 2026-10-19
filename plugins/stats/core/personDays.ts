import type { ArchiveRead } from '@plugin-sdk/core';
import type { ActivityQuery, StatsPoster } from '../shared/types';
import { local } from './query';
import { scopeSql } from './stats';

export interface PersonDay extends StatsPoster {
  start: string; firstTs: number; lastTs: number;
  rangeCount: number; rangeFirstTs: number | null; rangeLastTs: number | null;
}

/** Grouped local days retain counts and timestamp bounds so history also supplies exact-range active days. */
export async function personDays(read: ArchiveRead, query: ActivityQuery, selectedSinceTs = query.sinceTs): Promise<PersonDay[]> {
  const scope = (await scopeSql(read, query));
  const range = selectedSinceTs === null ? '1' : 'm.ts >= ?';
  const rangeParams = selectedSinceTs === null ? [] : [selectedSinceTs, selectedSinceTs, selectedSinceTs];
  return (await read(`SELECT m.author_id AS userId, date(${local('m.ts')}) AS start,
    MIN(m.author_plain_name) AS name, u.avatar AS avatar, COUNT(*) AS count, MIN(m.ts) AS firstTs, MAX(m.ts) AS lastTs,
    SUM(CASE WHEN ${range} THEN 1 ELSE 0 END) AS rangeCount,
    MIN(CASE WHEN ${range} THEN m.ts END) AS rangeFirstTs, MAX(CASE WHEN ${range} THEN m.ts END) AS rangeLastTs
    FROM archive_messages m LEFT JOIN archive_users u ON u.id = m.author_id
    WHERE ${scope.sql} GROUP BY m.author_id, start ORDER BY userId, start`, [...rangeParams, ...scope.params])) as PersonDay[];
}
