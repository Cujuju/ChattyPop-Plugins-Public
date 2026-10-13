/** Rankings keep only their declared output limit: linear in input size for a fixed section limit, with stable ties. */
export function rankedTop<T>(rows: Iterable<T>, limit: number, compare: (a: T, b: T) => number): T[] {
  const ranked: T[] = [];
  for (const row of rows) {
    let low = 0;
    let high = ranked.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (compare(row, ranked[middle]!) >= 0) low = middle + 1;
      else high = middle;
    }
    if (low >= limit) continue;
    ranked.splice(low, 0, row);
    if (ranked.length > limit) ranked.pop();
  }
  return ranked;
}
