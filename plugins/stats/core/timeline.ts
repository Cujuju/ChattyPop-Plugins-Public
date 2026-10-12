import type { PluginDb } from '@plugin-sdk/core';
import type { ActivityStats } from '../shared/types';
import { local, type StatsSqlScope } from './query';

/** First messages use the entire visible scope; the range only selects the months being reported. */
export function timeline(db: PluginDb, scope: StatsSqlScope, wholeScope: StatsSqlScope, start: number | null, last: number | null): Pick<ActivityStats, 'timeline' | 'archivedSince'> {
  const first = db.prepare(`SELECT date(${local('firstTs')}, 'start of month') AS start,
    SUM(CASE WHEN firstTs >= ? THEN 1 ELSE 0 END) AS count, MIN(firstTs) AS archivedSince
    FROM (SELECT MIN(m.ts) AS firstTs FROM archive_messages m WHERE ${wholeScope.sql} GROUP BY m.author_id)
    GROUP BY start`).all(start, ...wholeScope.params) as { start: string; count: number; archivedSince: number }[];
  const archivedSince = first.length ? Math.min(...first.map((r) => r.archivedSince)) : null;
  if (start === null || last === null) return { timeline: [], archivedSince };
  const active = db.prepare(`SELECT date(${local('m.ts')}, 'start of month') AS start,
    COUNT(DISTINCT m.author_id) AS count FROM archive_messages m WHERE ${scope.sql}
    GROUP BY start ORDER BY start`).all(...scope.params) as { start: string; count: number }[];
  const months = db.prepare(`WITH RECURSIVE months(start) AS (
    SELECT date(${local('?')}, 'start of month')
    UNION ALL SELECT date(start, '+1 month') FROM months WHERE start < date(${local('?')}, 'start of month')
  ) SELECT start FROM months`).pluck().all(start, last) as string[];
  const activeByMonth = new Map(active.map((r) => [r.start, r.count]));
  const newByMonth = new Map(first.map((r) => [r.start, r.count]));
  return { archivedSince, timeline: months.map((month) => ({ start: month, activePosters: activeByMonth.get(month) ?? 0, newPosters: newByMonth.get(month) ?? 0 })) };
}
