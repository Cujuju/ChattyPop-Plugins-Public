import { createEffect, createSignal, on } from 'solid-js';
import { ARCHIVE_REFRESH_DEBOUNCE_MS, callable, desktopCoreClient, onAppEvent, onAppEventDebounced, pluginData, pluginPreference, pluginResource, batchWrites, containedRoot } from '@plugin-sdk/renderer';
import { createPagedList } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import { emptyTotals, type AttachmentCursor, type AttachmentItem, type AttachmentMonth, type AttachmentPlaces, type AttachmentSortKey, type AttachmentTotals, type PersonRow } from '../shared/types';
import { selection } from './selection';
import { ATTACHMENT_PAGE_SIZE, WHO_OPTIONS_MAX, createAttachmentFilters } from './filterState';
export * from './filterState';

export const { where, setWhere, who, setWho, kinds, setKinds, range, setRange, minBytes, setMinBytes, presence, setPresence,
  uncompressed, setUncompressed, name, setName, sort, setSort, filter, unplaced, filterCount, resetFilters, queryName, snapshot, applySnapshot } = createAttachmentFilters();
export const [savedFilters, setSavedFilters] = pluginPreference(plugin, 'savedFilters');
export const [view, setView] = pluginPreference(plugin, 'view');
export const [hoverZoom, setHoverZoom] = pluginPreference(plugin, 'hoverZoom');
export const [anchor, setAnchor] = pluginPreference(plugin, 'anchor');
/** The order runs down from the top (a file browser's), not up from the bottom (a chat's). */
export const topDown = (): boolean => anchor() === 'top';

const client = desktopCoreClient(plugin);
const page = (q: Parameters<typeof client.page>[0]) => pluginData(() => client.page(q), []);
/** Rows top to bottom: from the top, the order as read; from the bottom, its first row last. */
const shown = (items: AttachmentItem[]): AttachmentItem[] => topDown() ? items : [...items].reverse();
const SORT_VALUE: Record<AttachmentSortKey, ((item: AttachmentItem) => string | number) | null> = {
  date: null, size: (i) => i.sortBytes, name: (i) => i.filename, kind: (i) => i.kind,
};
export const cursorAt = (item: AttachmentItem): AttachmentCursor => {
  const value = SORT_VALUE[sort().key];
  return { ts: item.ts, id: item.id, ...(value ? { key: value(item) } : {}) };
};
/** The next page of the order after `last` (the bottom-up list's top row, the top-down list's bottom row). */
const pageAfter = async (last: AttachmentItem): Promise<AttachmentItem[]> =>
  shown(await page({ ...filter(), sort: sort(), limit: ATTACHMENT_PAGE_SIZE, after: cursorAt(last) }));
const pageBefore = async (first: AttachmentItem): Promise<AttachmentItem[]> =>
  shown(await page({ ...filter(), sort: sort(), limit: ATTACHMENT_PAGE_SIZE, before: cursorAt(first) }));
const list = createPagedList<AttachmentItem>(ATTACHMENT_PAGE_SIZE,
  (first) => topDown() ? pageBefore(first) : pageAfter(first), (last) => topDown() ? pageAfter(last) : pageBefore(last));
export const attachments = list.state;
/** Top-down: more of the order lies below the last row loaded. */
const [moreBelow, setMoreBelow] = createSignal(false);
export const hasMoreBelow = (): boolean => moreBelow();
export const [jumped, setJumped] = createSignal(false);
let selectedMonth: string | null = null;
/** A page's failure shows only while its read is current: a filter change since has its own outcome. */
const loading = (load: () => Promise<number>): Promise<number> => {
  const generation = readGeneration;
  return load().catch((e: unknown) => { if (generation === readGeneration) setFailure(String(e)); return 0; });
};
export const loadOlderAttachments = (): Promise<number> => loading(() => list.loadOlder());
export const loadMoreBelow = (): Promise<number> => loading(async () => {
  if (!hasMoreBelow()) return 0;
  const generation = readGeneration;
  const added = await list.loadNewer();
  if (generation === readGeneration && added !== null && added < ATTACHMENT_PAGE_SIZE) setMoreBelow(false);
  return added ?? 0;
});
export const [totals, setTotals] = createSignal(emptyTotals());
export const [loads, setLoads] = createSignal(0);
export const [failure, setFailure] = createSignal<string | null>(null);
/** Raised by every read of the rows: a failure reported after a later read began is stale. */
let readGeneration = 0;
/** Raised when the archive or privacy changes what the counts read; a filter change refetches through the filter. */
const [revision, setRevision] = createSignal(0);

/** The Who picker's people within the other filters, most bytes on this PC first. */
export const people = pluginResource(plugin, 'people', () => {
  revision();
  return [{ ...filter(), authorId: undefined, limit: WHO_OPTIONS_MAX }];
}, [] as PersonRow[]);
/** The rail's counts, under every filter but the place. */
export const places = pluginResource(plugin, 'places', () => {
  revision();
  return [unplaced()];
}, { guilds: {}, channels: {} } as AttachmentPlaces);
export const months = pluginResource(plugin, 'months', () => { revision(); return [filter()]; }, [] as AttachmentMonth[]);

/** The order's first `limit` rows as shown; `reachedStart`: nothing loads above them (bottom-up: the order ends there). */
type Read = { items: AttachmentItem[]; reachedStart: boolean; moreBelow: boolean; counts: AttachmentTotals };
const readNewest = async (limit: number, startAt?: AttachmentCursor): Promise<Read> => {
  const f = filter();
  const order = sort(), top = topDown(), windowed = selectedMonth !== null;
  const [items, counts] = await Promise.all([page({ ...f, sort: order, limit,
    ...(windowed ? startAt ? { startAt } : { startMonth: selectedMonth! } : {}) }), pluginData(() => client.totals(f), emptyTotals())]);
  const complete = items.length < limit;
  const prior = windowed && items.length > 0 ? await page({ ...f, sort: order, limit: 1, before: { ts: items[0]!.ts, id: items[0]!.id } }) : [];
  return { items: top ? items : [...items].reverse(), reachedStart: top ? prior.length === 0 : complete,
    moreBelow: top ? !complete : prior.length > 0, counts };
};
async function apply(load: (keep: (r: Read) => void) => Promise<boolean>, opened: boolean): Promise<void> {
  const generation = ++readGeneration;
  // The read the rows took; none when they were kept as they were.
  let read: Read | null = null;
  try {
    if (!await load((r) => { read = r; })) return;
    const kept = read as Read | null;
    batchWrites(() => {
      if (kept) { setTotals(kept.counts); setMoreBelow(kept.moreBelow); }
      setFailure(null);
      if (opened) setLoads((n) => n + 1);
    });
  } catch (error) { if (generation === readGeneration) setFailure(String(error)); }
}

/** A filter, order or privacy change: the order's first page replaces the rows, opened where the order starts. */
const reloadWindow = (): Promise<void> =>
  apply((keep) => list.reload(async () => { const r = await readNewest(ATTACHMENT_PAGE_SIZE); keep(r); return r; }), true);
export const reloadAttachments = (): Promise<void> => {
  selectedMonth = null; setJumped(false);
  return reloadWindow();
};
export const jumpToMonth = (month: string): Promise<void> => {
  if (sort().key !== 'date') return Promise.resolve();
  selectedMonth = month; setJumped(true);
  return reloadWindow();
};

/**
 * An archive change: the loaded span reread in place; rows keep their objects by id, so tiles and pictures stay. A page
 * loaded during the read widens the span: it is read again over that, rather than dropping the page.
 */
export const rereadAttachments = (): Promise<void> => {
  const span = attachments.items.length;
  const first = topDown() ? attachments.items[0] : attachments.items.at(-1);
  return apply((keep) => list.update(() => readNewest(Math.max(ATTACHMENT_PAGE_SIZE, span), first ? cursorAt(first) : undefined), (r, items) => {
    if (items.length !== span) {
      queueMicrotask(() => void rereadAttachments());
      return [...items];
    }
    keep(r);
    return { items: r.items, reachedStart: r.reachedStart };
  }), false);
};

containedRoot(() => {
  createEffect(() => selection.retain(attachments.items));
  createEffect(on([where, who, kinds, range, minBytes, presence, uncompressed, queryName, sort, anchor, () => callable(plugin, 'page')],
    () => void reloadAttachments(), { defer: true }));
});
onAppEventDebounced('archive-changed', ARCHIVE_REFRESH_DEBOUNCE_MS, () => { setRevision((n) => n + 1); void rereadAttachments(); });
// Hidden files leave at once, before the reread returns.
onAppEvent('privacy-changed', () => {
  selection.clear();
  list.setItems([]);
  setTotals(emptyTotals());
  setRevision((n) => n + 1);
  void reloadAttachments();
});
