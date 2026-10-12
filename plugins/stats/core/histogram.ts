import type { PluginDb } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import type { ActivityStats, StatsPeriod } from '../shared/types';
import { local, type StatsSqlScope } from './query';

/** Spans longer than four months use weekly bars to remain legible. */
const DAY_BUCKETS_MAX_DAYS = 120;
const DAYS_PER_DAY_BUCKET = 1;
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const MONDAY_WEEKDAY = 1;
const MONTH_INDEX_OFFSET = 1;
const LOCAL_PART_WIDTH = 2;
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

const pad = (part: number): string => String(part).padStart(LOCAL_PART_WIDTH, '0');
const localDate = (start: string): Date => {
  const [year, month, day] = start.split('-').map(Number);
  return new Date(year!, month! - MONTH_INDEX_OFFSET, day!);
};
const dateStart = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + MONTH_INDEX_OFFSET)}-${pad(date.getDate())}`;
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
function filledBuckets(counts: Map<string, number>, bucket: ActivityStats['bucket']): ActivityStats['buckets'] {
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
  const spanDays = start === null || last === null ? 0 : (last - start) / MS_PER_DAY;
  const bucket = spanDays > DAY_BUCKETS_MAX_DAYS ? 'week' : 'day';
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
    let bucketStart = row.date;
    if (bucket === 'week') {
      const backstep = (weekday + DAYS_PER_WEEK - MONDAY_WEEKDAY) % DAYS_PER_WEEK;
      date.setDate(date.getDate() - backstep);
      bucketStart = dateStart(date);
    }
    addCount(buckets, bucketStart, row.count);
    addCount(hours, `${row.date}T${pad(row.hour)}:00:00`, row.count);
    addCount(days, row.date, row.count);
    addCount(months, `${row.date.slice(0, MONTH_DATE_LENGTH)}-01`, row.count);
    addCount(years, `${row.date.slice(0, YEAR_DATE_LENGTH)}-01-01`, row.count);
  }
  return {
    activeDays: days.size,
    mostActive: { hour: busiest(hours), day: busiest(days), month: busiest(months), year: busiest(years) },
    bucket,
    buckets: filledBuckets(buckets, bucket),
    heatmap,
  } satisfies Pick<ActivityStats, 'activeDays' | 'mostActive' | 'bucket' | 'buckets' | 'heatmap'>;
}
