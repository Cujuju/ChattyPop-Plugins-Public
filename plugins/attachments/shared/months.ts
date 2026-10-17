const MONTHS_PER_YEAR = 12;
/** Local calendar boundaries, matching the file list's dates, including daylight-saving changes. */
export function monthBounds(month: string): { start: number; end: number } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, number] = month.split('-').map(Number) as [number, number];
  const index = number - 1;
  const start = new Date(year, index).getTime();
  const end = new Date(year + Math.floor(number / MONTHS_PER_YEAR), number % MONTHS_PER_YEAR).getTime();
  return { start, end };
}
