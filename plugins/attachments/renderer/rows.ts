import type { AttachmentItem } from '../shared/types';

export type Row = { kind: 'day'; key: string; label: string } | { kind: 'items'; key: string; items: AttachmentItem[] };

/**
 * The files, top to bottom, cut into rows of `count` (and a divider before each day, when `dayOf` is given). A row's
 * key must outlive files loading at either end: the virtual log keeps the view on rows by key, and a view whose rows
 * all changed keys opens at the newest. So each day is cut from its side facing `origin` (the window's first file in
 * the order; the origin's own day at the origin) and keyed by its file nearest the origin: files arriving at the far
 * side only fill a row that keeps its key. Unknown origin: the order's first file, at `startAtTop`'s end.
 */
export function cutRows(items: readonly AttachmentItem[], o: {
  count: number; origin: string | null; startAtTop: boolean; dayOf: ((item: AttachmentItem) => string) | null;
}): Row[] {
  const found = o.origin === null ? -1 : items.findIndex((item) => item.id === o.origin);
  const at = found >= 0 ? found : o.startAtTop ? 0 : items.length - 1;
  // The order runs on from the origin: down from the top, up from the bottom.
  const cut = o.startAtTop ? at : at + 1;
  const out: Row[] = [];
  for (let first = 0; first < items.length;) {
    const label = o.dayOf?.(items[first]!) ?? '';
    let last = first;
    while (last + 1 < items.length && (o.dayOf?.(items[last + 1]!) ?? '') === label) last++;
    // Rows are cut at this index: at the origin, else at the day's end facing it.
    const ref = Math.min(Math.max(cut, first), last + 1);
    const nearest = items[Math.min(Math.max(at, first), last)]!;
    if (o.dayOf) out.push({ kind: 'day', key: `day-${nearest.id}`, label });
    for (let start = first; start <= last;) {
      const band = Math.floor((start - ref) / o.count);
      const end = Math.min(last, ref + (band + 1) * o.count - 1);
      const row = items.slice(start, end + 1);
      // Above the cut, the row's file nearest the origin is its last.
      out.push({ kind: 'items', key: (band < 0 ? row.at(-1)! : row[0]!).id, items: row });
      start = end + 1;
    }
    first = last + 1;
  }
  return out;
}
