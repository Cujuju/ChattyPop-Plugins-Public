// Merge a refreshed newest page with runs completed while the request was pending.
/** Core returns newest first; older paged-in rows never follow the refreshed newest page. */
export function mergeHistoryPage<T extends { id: number }>(page: readonly T[], current: readonly T[]): T[] {
  const newest = Math.max(0, ...page.map((row) => row.id));
  return [...page].reverse().concat(current.filter((row) => row.id > newest));
}
