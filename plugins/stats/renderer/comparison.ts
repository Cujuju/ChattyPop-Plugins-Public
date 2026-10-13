/** Percentage changes are rounded to whole percentage points. */
const PERCENT_SCALE = 100;

export function comparisonDelta(current: number, earlier: number): string {
  if (earlier === 0) return 'new';
  const change = Math.round((current - earlier) / earlier * PERCENT_SCALE);
  return `${change >= 0 ? '+' : ''}${change}%`;
}
