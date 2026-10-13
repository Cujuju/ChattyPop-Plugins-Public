// The history list: merging a refreshed newest page with runs completed meanwhile, which runs show their body, where failed runs sit, and which row has just landed.
import type { Summary, SummaryRunFailure } from '../shared/types';
/** Core returns newest first; older paged-in rows never follow the refreshed newest page. */
export function mergeHistoryPage<T extends { id: number }>(page: readonly T[], current: readonly T[]): T[] {
  const newest = Math.max(0, ...page.map((row) => row.id));
  return [...page].reverse().concat(current.filter((row) => row.id > newest));
}

/** Whether a run shows its body: as the reader last set it this session, else only the newest run does. */
export const runOpen = (toggles: ReadonlyMap<number, boolean>, id: number, newestId: number | null): boolean => toggles.get(id) ?? id === newestId;

/** A row of the history: a run, or a timed run that failed and is still owed. */
export type HistoryEntry = Summary | SummaryRunFailure;
export const isFailure = (e: HistoryEntry): e is SummaryRunFailure => 'runId' in e;
const enteredAt = (e: HistoryEntry): number => (isFailure(e) ? e.claimedAt : e.createdAt);
/** A row's identity across reads: a failure is read anew each time, and one run can owe more than one summary. */
export const entryKey = (e: HistoryEntry): string => (isFailure(e) ? `failed:${e.runId}:${e.actionId}` : `run:${e.id}`);

/**
 * The row that has just landed at the list's end: the newest, when `listed` (the rows' keys before) lacks it. Older
 * pages loading above, rows leaving and rows read again land nothing; with nothing listed before, the newest row has.
 */
export function landedRow(rows: readonly HistoryEntry[], listed: ReadonlySet<string>): HistoryEntry | null {
  const newest = rows.at(-1);
  return newest && !listed.has(entryKey(newest)) ? newest : null;
}

/**
 * Runs with each failure where its summary would be: by when it was first tried. A failure from before the loaded
 * runs waits for its page. Rows are the given objects, so a list keyed by them keeps its runs.
 */
export function historyEntries(runs: readonly Summary[], failures: readonly SummaryRunFailure[], reachedStart: boolean): HistoryEntry[] {
  const from = reachedStart ? -Infinity : (runs[0]?.createdAt ?? Infinity);
  return [...runs, ...failures.filter((f) => f.claimedAt >= from)].sort((a, b) => enteredAt(a) - enteredAt(b));
}
