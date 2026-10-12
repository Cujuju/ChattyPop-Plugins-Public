import { timeFormat } from '@plugin-sdk/shared';
import type { ActivityStats } from '../shared/types';

type Period = keyof ActivityStats['mostActive'];
const MONTH_INDEX_OFFSET = 1;
const FIRST_MONTH_DAY = 1;
const MIDNIGHT = 0;
const HOUR = timeFormat({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric' });
const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const YEAR = new Intl.DateTimeFormat(undefined, { year: 'numeric' });

export const formatTimestamp = (ts: number): string => DAY.format(new Date(ts));

/** SQL's local periods are numeric calendar parts, never UTC date-only strings. */
export function parsePeriod(start: string): Date {
  const [year, month, day = FIRST_MONTH_DAY, hour = MIDNIGHT, minute = MIDNIGHT, second = MIDNIGHT] = start.split(/[T:-]/).map(Number);
  return new Date(year!, month! - MONTH_INDEX_OFFSET, day, hour, minute, second);
}

export function formatPeriod(start: string, period: Period): string {
  const date = parsePeriod(start);
  return (period === 'hour' ? HOUR : period === 'day' ? DAY : period === 'month' ? MONTH : YEAR).format(date);
}
