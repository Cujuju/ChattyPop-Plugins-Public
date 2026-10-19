// The history list: merging a refreshed newest page with runs completed meanwhile, which runs show their body, where failed runs sit, and which row has just landed.
import type { Summary, SummaryRunFailure, SummaryScope } from '../shared/types';
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

/** A place as the rail picks it: a server, or one channel; null is everywhere. */
export interface HistoryPlace { by: 'guild' | 'channel'; id: string }
/** What a row needs of a channel: its server, and its parent when it is a thread. */
type ChannelOf = (id: string) => { guildId: string; parentId?: string | null } | undefined;

/**
 * Whether a run read within `place`: everywhere lists every row; a server, runs that read only it (its channels count);
 * a channel, runs that read only it or its threads. A run over everything, and a failed run (whose place isn't kept),
 * list only everywhere.
 */
export function readWithin(e: HistoryEntry, place: HistoryPlace | null, channel: ChannelOf): boolean {
  if (!place) return true;
  const scope: SummaryScope | null = isFailure(e) ? null : e.scope;
  if (!scope || (!scope.guildIds.length && !scope.channelIds.length)) return false;
  if (place.by === 'guild') return scope.guildIds.every((g) => g === place.id) && scope.channelIds.every((c) => channel(c)?.guildId === place.id);
  return !scope.guildIds.length && scope.channelIds.every((c) => c === place.id || channel(c)?.parentId === place.id);
}

/** Rows whose covered time overlaps the bounds, both ends inclusive; a null end doesn't bound. */
export function overlapping(rows: readonly HistoryEntry[], since: number | null, until: number | null): HistoryEntry[] {
  return rows.filter((e) => (since === null || e.untilTs >= since) && (until === null || e.sinceTs <= until));
}
