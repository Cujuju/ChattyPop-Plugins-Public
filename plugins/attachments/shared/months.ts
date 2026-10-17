import { MS_PER_HOUR, MS_PER_MIN, MS_PER_S } from '@plugin-sdk/shared';

const MONTH_DIGITS = 2;
/** `GMT`, `GMT-08:00` or, for zones before standard time, `GMT-07:52:58`. */
const OFFSET_NAME = /^GMT(?:([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** How far `timeZone` is ahead of UTC at `ts`, read from the zone's own offset name. */
function zoneOffset(offsetName: Intl.DateTimeFormat, ts: number): number {
  const name = offsetName.formatToParts(ts).find((p) => p.type === 'timeZoneName')!.value;
  const [, sign, h = '0', m = '0', s = '0'] = OFFSET_NAME.exec(name) ?? [];
  return (sign === '-' ? -1 : 1) * (Number(h) * MS_PER_HOUR + Number(m) * MS_PER_MIN + Number(s) * MS_PER_S);
}

/** When month `index` (0-based; 12 is the next January) of `year` begins in `timeZone`; else in this process's zone. */
function monthStart(year: number, index: number, timeZone?: string): number {
  if (!timeZone) return new Date(year, index).getTime();
  const offsetName = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const wall = Date.UTC(year, index);
  // A second reading settles a daylight-saving change between the first guess and the answer.
  const guess = wall - zoneOffset(offsetName, wall);
  return wall - zoneOffset(offsetName, guess);
}

/**
 * A calendar month's boundaries in `timeZone` (an IANA name; the viewer's, so they match the dates it shows), else in
 * this process's zone; daylight-saving changes included. Throws a RangeError for an unknown zone.
 */
export function monthBounds(month: string, timeZone?: string): { start: number; end: number } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, number] = month.split('-').map(Number) as [number, number];
  return { start: monthStart(year, number - 1, timeZone), end: monthStart(year, number, timeZone) };
}

/** The calendar month, as `YYYY-MM`, that `ts` falls in within `timeZone`, else this process's zone. */
export function monthOf(ts: number, timeZone?: string): string {
  let year: number, month: number;
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(ts);
    const part = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
    [year, month] = [part.year!, part.month!];
  } else {
    const date = new Date(ts);
    [year, month] = [date.getFullYear(), date.getMonth() + 1];
  }
  return `${year}-${String(month).padStart(MONTH_DIGITS, '0')}`;
}
