import { createEffect, createSignal, on } from 'solid-js';
import { ARCHIVE_REFRESH_DEBOUNCE_MS, callable, desktopCoreClient, onAppEvent, onAppEventDebounced, pluginData, pluginPreference, pluginResource, batchWrites, containedRoot } from '@plugin-sdk/renderer';
import { createPagedList } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import { emptyTotals, type AttachmentCursor, type AttachmentItem, type AttachmentPlaces, type AttachmentSortKey, type AttachmentTotals, type PersonRow } from '../shared/types';
import { selection } from './selection';
import { ATTACHMENT_PAGE_SIZE, WHO_OPTIONS_MAX, createAttachmentFilters } from './filterState';
export * from './filterState';

export const { where, setWhere, who, setWho, kinds, setKinds, range, setRange, minBytes, setMinBytes, presence, setPresence,
  uncompressed, setUncompressed, name, setName, sort, setSort, filter, unplaced, filterCount, resetFilters, queryName } = createAttachmentFilters();
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
// Bottom-up loads more above (older); top-down, below (newer). Top-down marks the start reached, so nothing loads above.
const list = createPagedList<AttachmentItem>(ATTACHMENT_PAGE_SIZE, pageAfter, pageAfter);
export const attachments = list.state;
/** Top-down: more of the order lies below the last row loaded. */
const [moreBelow, setMoreBelow] = createSignal(false);
export const hasMoreBelow = (): boolean => topDown() && moreBelow();
/** A page's failure shows only while its read is current: a filter change since has its own outcome. */
const loading = (load: () => Promise<number>): Promise<number> => {
  const generation = readGeneration;
  return load().catch((e: unknown) => { if (generation === readGeneration) setFailure(String(e)); return 0; });
};
export const loadOlderAttachments = (): Promise<number> => loading(() => list.loadOlder());
export const loadMoreBelow = (): Promise<number> => loading(async () => {
  if (!hasMoreBelow()) return 0;
  const added = await list.loadNewer();
  if (added !== null && added < ATTACHMENT_PAGE_SIZE) setMoreBelow(false);
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

/** The order's first `limit` rows as shown; `reachedStart`: nothing loads above them (bottom-up: the order ends there). */
type Read = { items: AttachmentItem[]; reachedStart: boolean; complete: boolean; counts: AttachmentTotals };
const readNewest = async (limit: number): Promise<Read> => {
  const f = filter();
  const [items, counts] = await Promise.all([page({ ...f, sort: sort(), limit }), pluginData(() => client.totals(f), emptyTotals())]);
  const complete = items.length < limit;
  return { items: shown(items), reachedStart: topDown() || complete, complete, counts };
};
async function apply(load: (keep: (r: Read) => void) => Promise<boolean>, opened: boolean): Promise<void> {
  const generation = ++readGeneration;
  // The read the rows took; none when they were kept as they were.
  let read: Read | null = null;
  try {
    if (!await load((r) => { read = r; })) return;
    const kept = read as Read | null;
    batchWrites(() => {
      if (kept) { setTotals(kept.counts); setMoreBelow(!kept.complete); }
      setFailure(null);
      if (opened) setLoads((n) => n + 1);
    });
  } catch (error) { if (generation === readGeneration) setFailure(String(error)); }
}

/** A filter, order or privacy change: the order's first page replaces the rows, opened where the order starts. */
export const reloadAttachments = (): Promise<void> =>
  apply((keep) => list.reload(async () => { const r = await readNewest(ATTACHMENT_PAGE_SIZE); keep(r); return r; }), true);

/**
 * An archive change: the loaded span reread in place; rows keep their objects by id, so tiles and pictures stay. A page
 * loaded during the read widens the span: it is read again over that, rather than dropping the page.
 */
export const rereadAttachments = (): Promise<void> => {
  const span = attachments.items.length;
  return apply((keep) => list.update(() => readNewest(Math.max(ATTACHMENT_PAGE_SIZE, span)), (r, items) => {
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
