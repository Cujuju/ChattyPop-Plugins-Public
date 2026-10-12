import { describe, expect, it } from 'vitest';
import { formatPeriod, parsePeriod } from '../renderer/periods';

const START = '2026-09-07T09:00:00';
const OPTIONS: Record<'hour' | 'day' | 'month' | 'year', Intl.DateTimeFormatOptions> = {
  hour: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric' },
  day: { day: 'numeric', month: 'short', year: 'numeric' },
  month: { month: 'long', year: 'numeric' },
  year: { year: 'numeric' },
};

describe('local Analytics periods', () => {
  it.each([
    ['2026-09-07T09:00:00', [2026, 8, 7, 9]],
    ['2026-09-07', [2026, 8, 7, 0]],
    ['2026-09', [2026, 8, 1, 0]],
    ['2026-01-01T23:00:00', [2026, 0, 1, 23]],
  ] as const)('constructs %s from local calendar parts', (start, expected) => {
    const date = parsePeriod(start);
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual(expected);
    expect([date.getMinutes(), date.getSeconds(), date.getMilliseconds()]).toEqual([0, 0, 0]);
  });

  it.each(['hour', 'day', 'month', 'year'] as const)('formats the locale parts needed for a %s', (period) => {
    const date = parsePeriod(START);
    const parts = new Intl.DateTimeFormat(undefined, OPTIONS[period]).formatToParts(date).filter((part) => part.type !== 'literal');
    const label = formatPeriod(START, period);
    for (const part of parts) expect(label).toContain(part.value);
    expect(parsePeriod('2026-09-07').getDay()).toBe(1);
  });
});
