// Summary history paging in the renderer: a refreshed page merges in order.
import { expect, it } from 'vitest';
import { mergeHistoryPage } from '../renderer/historyPage';

it('refreshes summary history in chronological order without old pages becoming newest or duplicating', () => {
  const rows = Array.from({ length: 46 }, (_, index) => ({ id: index + 1 }));
  const page = rows.slice(25, 45).reverse();
  const merged = mergeHistoryPage(page, rows);
  expect(merged.map((row) => row.id)).toEqual(rows.slice(25).map((row) => row.id));
  expect(merged.at(-1)?.id).toBe(46);
});
