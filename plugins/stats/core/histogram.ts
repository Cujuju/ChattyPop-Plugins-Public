import type { PluginDb } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import type { ActivityStats, StatsPeriod } from '../shared/types';
import { dateStart, localDate, localPart, local, type StatsSqlScope } from './query';
import { dayStreaks } from './streaks';

/** Spans longer than four months use weekly bars to remain legible. */
const DAY_BUCKETS_MAX_DAYS = 120;
const DAYS_PER_DAY_BUCKET = 1;
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const MONDAY_WEEKDAY = 1;
const MONTH_DATE_LENGTH = 'YYYY-MM'.length;
const YEAR_DATE_LENGTH = 'YYYY'.length;

interface HourCount {
  date: string;
  hour: number;
  count: number;
}

/** One local-date/hour grouping supplies all message-time aggregates. */
export function hourlyHistogram(db: PluginDb, scope: StatsSqlScope): HourCount[] {
  return db.prepare(`SELECT date(${local('m.ts')}) AS date,
    CAST(strftime('%H', ${local('m.ts')}) AS INTEGER) AS hour, COUNT(*) AS count
    FROM archive_messages m WHERE ${scope.sql} GROUP BY date, hour ORDER BY date, hour`)
    .all(...scope.params) as HourCount[];
}

export function bucketForSpan(start: number | null, last: number | null): ActivityStats['bucket'] {
  const spanDays = start === null || last === null ? 0 : (last - start) / MS_PER_DAY;
  return spanDays > DAY_BUCKETS_MAX_DAYS ? 'week' : 'day';
}

export function bucketStart(date: Date, bucket: ActivityStats['bucket']): string {
  const local = new Date(date);
  if (bucket === 'week') {
    const backstep = (local.getDay() + DAYS_PER_WEEK - MONDAY_WEEKDAY) % DAYS_PER_WEEK;
    local.setDate(local.getDate() - backstep);
  }
  return dateStart(local);
}
const addCount = (counts: Map<string, number>, start: string, count: number): void => {
  counts.set(start, (counts.get(start) ?? 0) + count);
};

/** Period ties select the earliest local start. */
function busiest(counts: Map<string, number>): StatsPeriod | null {
  let result: StatsPeriod | null = null;
  for (const [start, count] of counts) {
    if (!result || count > result.count || (count === result.count && start < result.start)) result = { start, count };
  }
  return result;
}

/** Calendar increments preserve local dates across daylight-saving changes. */
export function filledBuckets(counts: Map<string, number>, bucket: ActivityStats['bucket']): ActivityStats['buckets'] {
  const starts = [...counts.keys()].sort();
  if (!starts.length) return [];
  const date = localDate(starts[0]!);
  const last = starts.at(-1)!;
  const step = bucket === 'week' ? DAYS_PER_WEEK : DAYS_PER_DAY_BUCKET;
  const result: ActivityStats['buckets'] = [];
  for (let start = dateStart(date); start <= last; start = dateStart(date)) {
    result.push({ start, count: counts.get(start) ?? 0 });
    date.setDate(date.getDate() + step);
  }
  return result;
}

export function timeStats(histogram: HourCount[], start: number | null, last: number | null) {
  const bucket = bucketForSpan(start, last);
  const heatmap = Array.from({ length: DAYS_PER_WEEK }, () => new Array<number>(HOURS_PER_DAY).fill(0));
  const buckets = new Map<string, number>();
  const hours = new Map<string, number>();
  const days = new Map<string, number>();
  const months = new Map<string, number>();
  const years = new Map<string, number>();
  for (const row of histogram) {
    const date = localDate(row.date);
    const weekday = date.getDay();
    heatmap[weekday]![row.hour]! += row.count;
    addCount(buckets, bucketStart(date, bucket), row.count);
    addCount(hours, `${row.date}T${localPart(row.hour)}:00:00`, row.count);
    addCount(days, row.date, row.count);
    addCount(months, `${row.date.slice(0, MONTH_DATE_LENGTH)}-01`, row.count);
    addCount(years, `${row.date.slice(0, YEAR_DATE_LENGTH)}-01-01`, row.count);
  }
  return {
    activeDays: days.size,
    streaks: dayStreaks(days.keys()),
    mostActive: { hour: busiest(hours), day: busiest(days), month: busiest(months), year: busiest(years) },
    bucket,
    buckets: filledBuckets(buckets, bucket),
    heatmap,
  } satisfies Pick<ActivityStats, 'activeDays' | 'streaks' | 'mostActive' | 'bucket' | 'buckets' | 'heatmap'>;
}
