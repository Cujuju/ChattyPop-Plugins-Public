// Grid rows keep their keys as files load at either end, so the virtual log can keep the view where it was.
import { describe, expect, it } from 'vitest';
import type { AttachmentItem } from '../shared/types';
import { cutRows, type Row } from '../renderer/rows';

const COLS = 4;
/** Files per day large enough that every file in a test is on one day. */
const SAME_DAY = 100;
/** Files 0..n-1 in display order, `perDay` to a day. */
const files = (from: number, to: number): AttachmentItem[] =>
  Array.from({ length: to - from }, (_, i) => ({ id: String(from + i) }) as AttachmentItem);
const dayOf = (perDay: number) => (item: AttachmentItem): string => `d${Math.floor(Number(item.id) / perDay)}`;
const shape = (rows: Row[]): string[] => rows.map((r) => r.kind === 'day' ? `${r.key}|${r.label}` : `${r.key}:${r.items.map((i) => i.id).join(',')}`);
/** Every row of `before` still has its key, and the same files apart from ones that only filled it. */
const kept = (before: Row[], after: Row[]): void => {
  const keys = new Map(after.map((r) => [r.key, r]));
  for (const row of before) {
    const now = keys.get(row.key);
    expect(now, row.key).toBeDefined();
    if (row.kind === 'items' && now?.kind === 'items') expect(now.items.map((i) => i.id)).toEqual(expect.arrayContaining(row.items.map((i) => i.id)));
  }
};

describe('rows cut from the origin', () => {
  it('from the bottom: each day fills from its bottom, and older files above leave every row in place', () => {
    const cut = (from: number) => cutRows(files(from, 20), { count: COLS, origin: '19', startAtTop: false, dayOf: dayOf(10) });
    const before = cut(13);
    expect(shape(before)).toEqual(['day-19|d1', '15:13,14,15', '19:16,17,18,19']);
    const after = cut(3);
    kept(before, after);
    expect(shape(after)).toEqual(['day-9|d0', '5:3,4,5', '9:6,7,8,9', 'day-19|d1', '11:10,11', '15:12,13,14,15', '19:16,17,18,19']);
    // Files newer than the origin (an archive reread) start a row of their own below it.
    const arrived = cutRows(files(13, 22), { count: COLS, origin: '19', startAtTop: false, dayOf: dayOf(SAME_DAY) });
    kept(before, arrived);
    expect(shape(arrived).at(-1)).toBe('20:20,21');
  });

  it('from the top: files below fill the bottom row of their day', () => {
    const cut = (to: number) => cutRows(files(0, to), { count: COLS, origin: null, startAtTop: true, dayOf: dayOf(10) });
    const before = cut(6);
    expect(shape(before)).toEqual(['day-0|d0', '0:0,1,2,3', '4:4,5']);
    kept(before, cut(14));
  });

  it("a jumped window keeps its rows as files load on both sides, and the origin's day is cut at the origin", () => {
    const cut = (from: number, to: number) => cutRows(files(from, to), { count: COLS, origin: '12', startAtTop: true, dayOf: dayOf(10) });
    const before = cut(12, 16);
    expect(shape(before)).toEqual(['day-12|d1', '12:12,13,14,15']);
    const after = cut(5, 27);
    kept(before, after);
    expect(shape(after)).toEqual(['day-9|d0', '5:5', '9:6,7,8,9', 'day-12|d1', '11:10,11', '12:12,13,14,15', '16:16,17,18,19', 'day-20|d2', '20:20,21,22,23', '24:24,25,26']);
  });

  it('without days, the whole order is one run; an origin no longer loaded falls back to the start', () => {
    expect(shape(cutRows(files(0, 6), { count: COLS, origin: 'gone', startAtTop: false, dayOf: null }))).toEqual(['1:0,1', '5:2,3,4,5']);
    expect(cutRows([], { count: COLS, origin: null, startAtTop: true, dayOf: null })).toEqual([]);
  });
});
