import { MS_PER_S } from '@plugin-sdk/shared';
import type { ActivityQuery } from '../shared/types';

/** Exact channel membership for AI reads; unlike the panel scope, threads are never added implicitly. */
export interface ChannelListQuery {
  scope: 'channels';
  channelIds: readonly string[];
  sinceTs: number | null;
  untilTs: number | null;
  authorId?: string | null;
}
export type TextQuery = ActivityQuery | ChannelListQuery;

export interface StatsSqlScope {
  sql: string;
  params: (string | number)[];
}

/** SQLite time modifiers turning a millisecond column into local time. */
export const local = (ts: string): string => `${ts} / ${MS_PER_S}, 'unixepoch', 'localtime'`;

/** Local date fields have two-digit months/days and JavaScript's zero-based month index. */
const LOCAL_PART_WIDTH = 2;
const MONTH_INDEX_OFFSET = 1;
export const localPart = (part: number): string => String(part).padStart(LOCAL_PART_WIDTH, '0');
export const localDate = (start: string): Date => {
  const [year, month, day] = start.split('-').map(Number);
  return new Date(year!, month! - MONTH_INDEX_OFFSET, day!);
};
export const dateStart = (date: Date): string => `${date.getFullYear()}-${localPart(date.getMonth() + MONTH_INDEX_OFFSET)}-${localPart(date.getDate())}`;

export function shiftLocalDay(start: string, days: number): string {
  const date = localDate(start);
  date.setDate(date.getDate() + days);
  return dateStart(date);
}
