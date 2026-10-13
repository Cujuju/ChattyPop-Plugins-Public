import type { PluginDb } from '@plugin-sdk/core';
import type { PersonStreak, StreakStats } from '../shared/streaks';
import { STATS_TOP, type ActivityQuery } from '../shared/types';
import { local, shiftLocalDay } from './query';
import { scopeSql } from './stats';

/** Local calendar increments count active runs and the inactive dates between them. Ties retain the earlier start. */
export function dayStreaks(dates: Iterable<string>, includeSilences = true): StreakStats {
  const days = [...new Set(dates)].sort();
  let longest: StreakStats['longest'] = null;
  let current = { days: 0, start: '', end: '' };
  let gap: StreakStats['gap'] = null;
  for (const date of days) {
    const next = current.days ? shiftLocalDay(current.end, 1) : null;
    if (next === date) current = { ...current, days: current.days + 1, end: date };
    else {
      if (includeSilences && next && next < date) {
        let inactiveDays = 0;
        for (let inactive = next; inactive < date; inactive = shiftLocalDay(inactive, 1)) inactiveDays++;
        if (!gap || inactiveDays > gap.days) gap = { days: inactiveDays, start: next, end: shiftLocalDay(date, -1) };
      }
      current = { days: 1, start: date, end: date };
    }
    if (!longest || current.days > longest.days) longest = current;
  }
  return { longest, current: current.days ? current : null, gap };
}

/** One distinct author/date read supplies the People section's longest runs. */
export function personStreaks(db: PluginDb, query: ActivityQuery): PersonStreak[] {
  const scope = scopeSql(db, query);
  const rows = db.prepare(`SELECT DISTINCT m.author_id AS userId, date(${local('m.ts')}) AS start
    FROM archive_messages m WHERE ${scope.sql} ORDER BY userId, start`).all(...scope.params) as { userId: string; start: string }[];
  const dates = new Map<string, string[]>();
  for (const row of rows) {
    const person = dates.get(row.userId) ?? [];
    person.push(row.start);
    dates.set(row.userId, person);
  }
  return [...dates].map(([userId, dates]) => ({ userId, ...dayStreaks(dates, false).longest! }))
    .sort((a, b) => b.days - a.days || a.start.localeCompare(b.start) || a.userId.localeCompare(b.userId)).slice(0, STATS_TOP);
}
