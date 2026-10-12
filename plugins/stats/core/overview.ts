import type { PluginDb } from '@plugin-sdk/core';
import type { ActivityStats, StatsPeriod } from '../shared/types';
import { local, type StatsSqlScope } from './query';

type Totals = Pick<ActivityStats, 'messages' | 'authors' | 'activeDays' | 'editedMessages' | 'textMessages' | 'attachmentMessages'> & {
  firstTs: number | null;
  lastTs: number | null;
};

export function totals(db: PluginDb, scope: StatsSqlScope): Totals {
  return db.prepare(`SELECT COUNT(*) AS messages, COUNT(DISTINCT m.author_id) AS authors,
    COUNT(DISTINCT date(${local('m.ts')})) AS activeDays,
    COUNT(CASE WHEN m.edited_ts IS NOT NULL THEN 1 END) AS editedMessages,
    COUNT(CASE WHEN trim(m.content, char(9) || char(10) || char(13) || ' ') != '' THEN 1 END) AS textMessages,
    COUNT(CASE WHEN EXISTS (SELECT 1 FROM archive_attachments a WHERE a.message_id = m.id) THEN 1 END) AS attachmentMessages,
    MIN(m.ts) AS firstTs, MAX(m.ts) AS lastTs
    FROM archive_messages m WHERE ${scope.sql}`).get(...scope.params) as Totals;
}

/** Period ties select the earliest local start. */
export function mostActive(db: PluginDb, scope: StatsSqlScope): ActivityStats['mostActive'] {
  const starts = {
    hour: `strftime('%Y-%m-%dT%H:00:00', ${local('m.ts')})`,
    day: `date(${local('m.ts')})`,
    month: `date(${local('m.ts')}, 'start of month')`,
    year: `date(${local('m.ts')}, 'start of year')`,
  };
  const busiest = (startSql: string): StatsPeriod | null =>
    db.prepare(`SELECT ${startSql} AS start, COUNT(*) AS count FROM archive_messages m
      WHERE ${scope.sql} GROUP BY start ORDER BY count DESC, start LIMIT 1`).get(...scope.params) as StatsPeriod | undefined ?? null;
  return { hour: busiest(starts.hour), day: busiest(starts.day), month: busiest(starts.month), year: busiest(starts.year) };
}
