// The history list: merging a refreshed newest page with runs completed meanwhile, and which runs show their body.
/** Core returns newest first; older paged-in rows never follow the refreshed newest page. */
export function mergeHistoryPage<T extends { id: number }>(page: readonly T[], current: readonly T[]): T[] {
  const newest = Math.max(0, ...page.map((row) => row.id));
  return [...page].reverse().concat(current.filter((row) => row.id > newest));
}

/** Whether a run shows its body: as the reader last set it this session, else only the newest run does. */
export const runOpen = (toggles: ReadonlyMap<number, boolean>, id: number, newestId: number | null): boolean => toggles.get(id) ?? id === newestId;
