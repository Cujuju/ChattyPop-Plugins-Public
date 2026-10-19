// Summary history in the renderer: a refreshed page merges in order, which runs list under a place, which runs show their body, where failed runs sit, which row has just landed, and a run's facts.
import { expect, it } from 'vitest';
import { entryKey, historyEntries, isFailure, landedRow, mergeHistoryPage, overlapping, readWithin, runOpen } from '../renderer/historyPage';
import { durationText, runFacts, type FactText } from '../renderer/runFacts';
import type { Summary, SummaryRunFailure } from '../shared/types';

it('shows only the newest run open until the reader folds or opens one', () => {
  const untouched = new Map<number, boolean>();
  expect([1, 2, 3].map((id) => runOpen(untouched, id, 3))).toEqual([false, false, true]);
  // A newer run arrives: it opens, and the one that was newest folds.
  expect([3, 4].map((id) => runOpen(untouched, id, 4))).toEqual([false, true]);
  // What the reader set stays, whichever run is newest.
  const set = new Map([[1, true], [4, false]]);
  expect([1, 2, 4].map((id) => runOpen(set, id, 4))).toEqual([true, false, false]);
  expect(runOpen(untouched, 1, null)).toBe(false);
});

it('refreshes summary history in chronological order without old pages becoming newest or duplicating', () => {
  const rows = Array.from({ length: 46 }, (_, index) => ({ id: index + 1 }));
  const page = rows.slice(25, 45).reverse();
  const merged = mergeHistoryPage(page, rows);
  expect(merged.map((row) => row.id)).toEqual(rows.slice(25).map((row) => row.id));
  expect(merged.at(-1)?.id).toBe(46);
});

const ranAt = (id: number, createdAt: number): Summary => ({ id, createdAt }) as Summary;
const failedAt = (runId: number, claimedAt: number): SummaryRunFailure => ({ runId, claimedAt }) as SummaryRunFailure;

it('puts a failed run where its summary would be, by when it was first tried', () => {
  const runs = [ranAt(1, 100), ranAt(2, 300)];
  const entries = historyEntries(runs, [failedAt(9, 400), failedAt(8, 200)], true);
  expect(entries.map((e) => (isFailure(e) ? `failed ${e.runId}` : `run ${e.id}`))).toEqual(['run 1', 'failed 8', 'run 2', 'failed 9']);
  // The rows are the given objects: a list keyed by them keeps its runs.
  expect(entries[0]).toBe(runs[0]);
});

it('holds a failure from before the loaded runs until its page is loaded', () => {
  const runs = [ranAt(2, 300)];
  const failures = [failedAt(8, 200), failedAt(9, 400)];
  expect(historyEntries(runs, failures, false).filter(isFailure).map((f) => f.runId)).toEqual([9]);
  expect(historyEntries(runs, failures, true).filter(isFailure).map((f) => f.runId)).toEqual([8, 9]);
  // No run loaded yet and more to load: nothing says where a failure sits.
  expect(historyEntries([], failures, false)).toEqual([]);
  expect(historyEntries([], failures, true)).toHaveLength(2);
});

it('tells the row that has just landed at the end from older pages, rows leaving and rows read again', () => {
  const rows = [ranAt(1, 100), ranAt(2, 300)];
  const listed = new Set(rows.map(entryKey));
  // Nothing listed before: the newest row has landed.
  expect(landedRow(rows, new Set())).toBe(rows[1]);
  expect(landedRow([], new Set())).toBeNull();
  const newer = ranAt(3, 500);
  expect(landedRow([...rows, newer], listed)).toBe(newer);
  // An older page above, the newest row leaving, and a failure read again as a new object.
  expect(landedRow([ranAt(0, 50), ...rows], listed)).toBeNull();
  expect(landedRow(rows.slice(0, 1), listed)).toBeNull();
  const failed = failedAt(9, 400);
  expect(landedRow([...rows, { ...failed }], new Set([...listed, entryKey(failed)]))).toBeNull();
  expect(landedRow([...rows, failed], listed)).toBe(failed);
});

const TEXT: FactText ={ provider: 'Claude', tokens: (n) => `${n}t`, usd: (n) => `$${n}` };
const run = (over: Partial<Summary>): Summary =>
  ({ messageCount: 89, skippedCount: 0, durationMs: 127_000, model: 'haiku', usage: null, apiCostUsd: null, apiCostEstimated: false, jevCostUsd: null, ...over }) as Summary;
const labelled = (s: Summary): Record<string, string> => Object.fromEntries(runFacts(s, TEXT).map((f) => [f.label, f.value]));

it('writes a run time in seconds, and in minutes and seconds from a minute up', () => {
  expect([42_000, 59_400, 60_000, 127_000].map(durationText)).toEqual(['42 s', '59 s', '1 m 0 s', '2 m 7 s']);
});

it('lists a run as labelled facts: the figures first, its cost marked, its model last', () => {
  const facts = runFacts(run({ skippedCount: 4, usage: { inputTokens: 7500, cachedInputTokens: 500, outputTokens: 300 }, apiCostUsd: 0.02, jevCostUsd: 0.0018 }), TEXT);
  expect(facts.map((f) => [f.label, f.value])).toEqual([
    ['Messages', '89 · 4 skipped'],
    ['Took', '2 m 7 s'],
    ['Tokens', '7500t in (500t cached) · 300t out'],
    ['API cost', '≈$0.02'],
    ['Jev', '$0.0018'],
    ['Model', 'Claude · haiku'],
  ]);
  expect(facts.filter((f) => f.strong).map((f) => f.label)).toEqual(['API cost']);
});

it('says what a run that called a model did not report, and leaves both out of one that called none', () => {
  expect(labelled(run({}))).toMatchObject({ Tokens: 'not reported', 'API cost': 'unknown' });
  expect(Object.keys(labelled(run({ messageCount: 0, model: null })))).toEqual(['Messages', 'Took', 'Model']);
  expect(labelled(run({ messageCount: 0, model: null })).Model).toBe('Claude');
});

it('lists the runs and failures whose covered time overlaps the time frame, both ends inclusive', () => {
  const span = (id: number, sinceTs: number, untilTs: number): Summary => ({ id, sinceTs, untilTs }) as Summary;
  const failure = { runId: 9, sinceTs: 40, untilTs: 50 } as SummaryRunFailure;
  const rows = [span(1, 0, 10), span(2, 10, 20), span(3, 25, 30), failure];
  const ids = (since: number | null, until: number | null) => overlapping(rows, since, until).map((e) => (isFailure(e) ? `f${e.runId}` : e.id));
  expect(ids(null, null)).toEqual([1, 2, 3, 'f9']);
  expect(ids(10, 25)).toEqual([1, 2, 3]);
  expect(ids(21, 24)).toEqual([]);
  expect(ids(45, null)).toEqual(['f9']);
});

const CHANNELS: Record<string, { guildId: string; parentId?: string }> = {
  general: { guildId: 'home' }, side: { guildId: 'home', parentId: 'general' }, news: { guildId: 'home' }, lobby: { guildId: 'away' },
};
const channelOf = (id: string) => CHANNELS[id];
const over = (guildIds: string[], channelIds: string[]): Summary => ({ id: 1, createdAt: 1, scope: { guildIds, channelIds } }) as Summary;

it('lists under a place only the runs that read within it; everything and failed runs list only everywhere', () => {
  const everything = { id: 2, createdAt: 2, scope: null } as Summary;
  const home = over(['home'], []);
  const general = over([], ['general']);
  const thread = over([], ['side']);
  const homeChannels = over([], ['general', 'news']);
  const mixed = over([], ['general', 'lobby']);
  const rows = [everything, home, general, thread, homeChannels, mixed, failedAt(9, 9)];
  const listed = (place: Parameters<typeof readWithin>[1]) => rows.filter((e) => readWithin(e, place, channelOf));
  expect(listed(null)).toEqual(rows);
  expect(listed({ by: 'guild', id: 'home' })).toEqual([home, general, thread, homeChannels]);
  expect(listed({ by: 'channel', id: 'general' })).toEqual([general, thread]);
  expect(listed({ by: 'guild', id: 'away' })).toEqual([]);
});
