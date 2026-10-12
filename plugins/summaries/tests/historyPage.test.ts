// Summary history in the renderer: a refreshed page merges in order, which runs show their body, where failed runs sit, and a run's facts.
import { expect, it } from 'vitest';
import { historyEntries, isFailure, mergeHistoryPage, runOpen } from '../renderer/historyPage';
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

const TEXT: FactText = { provider: 'Claude', tokens: (n) => `${n}t`, usd: (n) => `$${n}` };
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
