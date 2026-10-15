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

const client = desktopCoreClient(plugin);
const page = (q: Parameters<typeof client.page>[0]) => pluginData(() => client.page(q), []);
const oldestFirst = (items: AttachmentItem[]): AttachmentItem[] => [...items].reverse();
const SORT_VALUE: Record<AttachmentSortKey, ((item: AttachmentItem) => string | number) | null> = {
  date: null, size: (i) => i.sortBytes, name: (i) => i.filename, kind: (i) => i.kind,
};
export const cursorAt = (item: AttachmentItem): AttachmentCursor => {
  const value = SORT_VALUE[sort().key];
  return { ts: item.ts, id: item.id, ...(value ? { key: value(item) } : {}) };
};
const list = createPagedList<AttachmentItem>(ATTACHMENT_PAGE_SIZE,
  async (oldest) => oldestFirst(await page({ ...filter(), sort: sort(), limit: ATTACHMENT_PAGE_SIZE, after: cursorAt(oldest) })),
);
export const attachments = list.state;
export const loadOlderAttachments = (): Promise<number> => list.loadOlder().catch((e: unknown) => { setFailure(String(e)); return 0; });
export const [totals, setTotals] = createSignal(emptyTotals());
export const [loads, setLoads] = createSignal(0);
export const [failure, setFailure] = createSignal<string | null>(null);
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

type Read = { items: AttachmentItem[]; reachedStart: boolean; counts: AttachmentTotals };
const readNewest = async (limit: number): Promise<Read> => {
  const f = filter();
  const [items, counts] = await Promise.all([page({ ...f, sort: sort(), limit }), pluginData(() => client.totals(f), emptyTotals())]);
  return { items: oldestFirst(items), reachedStart: items.length < limit, counts };
};
let readGeneration = 0;
async function apply(load: (keep: (r: Read) => void) => Promise<boolean>, opened: boolean): Promise<void> {
  const generation = ++readGeneration;
  let counts = emptyTotals();
  try {
    if (!await load((r) => { counts = r.counts; })) return;
    batchWrites(() => { setTotals(counts); setFailure(null); if (opened) setLoads((n) => n + 1); });
  } catch (error) { if (generation === readGeneration) setFailure(String(error)); }
}

/** A filter or privacy change: the newest page replaces the rows, opened at the newest. */
export const reloadAttachments = (): Promise<void> =>
  apply((keep) => list.reload(async () => { const r = await readNewest(ATTACHMENT_PAGE_SIZE); keep(r); return r; }), true);

/** An archive change: the loaded span reread in place; rows keep their objects by id, so tiles and pictures stay. */
export const rereadAttachments = (): Promise<void> =>
  apply((keep) => list.update(() => readNewest(Math.max(ATTACHMENT_PAGE_SIZE, attachments.items.length)), (r) => { keep(r); return r.items; }), false);

containedRoot(() => {
  createEffect(() => selection.retain(attachments.items));
  createEffect(on([where, who, kinds, range, minBytes, presence, uncompressed, queryName, sort, () => callable(plugin, 'page')],
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
