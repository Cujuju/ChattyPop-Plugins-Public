/** An even sample's median averages its two central observations. */


export function median(frequencies: Map<number, number>, observations: number): number {
  const MEDIAN_HALVES = 2; // The two central observations define an even median.
  if (!observations) return 0;
  const lower = Math.floor((observations - 1) / MEDIAN_HALVES);
  const upper = Math.floor(observations / MEDIAN_HALVES);
  let seen = 0;
  let lowerValue = 0;
  for (const [value, count] of [...frequencies].sort(([a], [b]) => a - b)) {
    if (seen <= lower && seen + count > lower) lowerValue = value;
    if (seen + count > upper) return (lowerValue + value) / MEDIAN_HALVES;
    seen += count;
  }
  return 0;
}
