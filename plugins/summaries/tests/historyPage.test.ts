// Summary history in the renderer: a refreshed page merges in order, and which runs show their body.
import { expect, it } from 'vitest';
import { mergeHistoryPage, runOpen } from '../renderer/historyPage';

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
