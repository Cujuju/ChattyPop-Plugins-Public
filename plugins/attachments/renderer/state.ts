import { createEffect, createSignal, on } from 'solid-js';
import { callable, coalescedRead, desktopCoreClient, onAppEvent, onArchiveChange, panelShown, pluginData, pluginPreference, pluginResource, batchWrites, containedRoot } from '@plugin-sdk/renderer';
import { createPagedList } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import { emptyTotals, type AttachmentBreakdown, type BreakdownBy, type AttachmentCursor, type AttachmentItem, type AttachmentMonth, type AttachmentPlaces, type AttachmentSortKey, type AttachmentTotals, type PersonRow } from '../shared/types';
import { selection } from './selection';
import { ATTACHMENT_PAGE_SIZE, WHO_OPTIONS_MAX, createAttachmentFilters } from './filterState';
export * from './filterState';

export const { where, setWhere, who, setWho, kinds, setKinds, range, setRange, minBytes, setMinBytes, presence, setPresence,
  uncompressed, setUncompressed, repeated, setRepeated, name, setName, sort, setSort, filter, unplaced, filterCount, resetFilters, queryName, snapshot, applySnapshot } = createAttachmentFilters();
export const [savedFilters, setSavedFilters] = pluginPreference(plugin, 'savedFilters');
export const [view, setView] = pluginPreference(plugin, 'view');
export const [hoverZoom, setHoverZoom] = pluginPreference(plugin, 'hoverZoom');
export const [anchor, setAnchor] = pluginPreference(plugin, 'anchor');
export const [channelsHidden, setChannelsHidden] = pluginPreference(plugin, 'channelsHidden');
export const [spaceView, setSpaceView] = createSignal(false);
export const [breakdownBy, setBreakdownBy] = createSignal<BreakdownBy>('guild');
/** The order runs down from the top (a file browser's), not up from the bottom (a chat's). */
export const topDown = (): boolean => anchor() === 'top';

const client = desktopCoreClient(plugin);
const isShown = panelShown('attachments');
let privacyEpoch = 0;
const refreshOn = { kinds: ['attachments', 'edits', 'deletes', 'names'] as const };
const scope = () => where() ? where()!.by === 'guild' ? { guildIds: [where()!.id] } : { channelIds: [where()!.id] } : 'all' as const;
const page = (q: Parameters<typeof client.page>[0], signal?: AbortSignal) => pluginData(() => desktopCoreClient(plugin, { signal, priority: isShown() ? 'interactive' : 'background' }).page(q), []);
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
const pageAfter = async (last: AttachmentItem, signal?: AbortSignal): Promise<AttachmentItem[]> =>
  shown(await page({ ...filter(), sort: sort(), limit: ATTACHMENT_PAGE_SIZE, after: cursorAt(last) }, signal));
const pageBefore = async (first: AttachmentItem, signal?: AbortSignal): Promise<AttachmentItem[]> =>
  shown(await page({ ...filter(), sort: sort(), limit: ATTACHMENT_PAGE_SIZE, before: cursorAt(first) }, signal));
const list = createPagedList<AttachmentItem>(ATTACHMENT_PAGE_SIZE,
  (first, signal) => topDown() ? pageBefore(first, signal) : pageAfter(first, signal), (last, signal) => topDown() ? pageAfter(last, signal) : pageBefore(last, signal), {
    shown: isShown, chronological: () => sort().key === 'date' && sort().dir === 'desc' && !jumped(),
    newestAtStart: topDown, newer: pageBefore, reload: (signal) => reloadAttachments(signal),
  });
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
export const breakdown = pluginResource(plugin, 'breakdown', () => {
  return spaceView() ? [filter(), breakdownBy()] : null;
}, [] as AttachmentBreakdown[], { refreshOn: { ...refreshOn, scope }, shown: () => isShown() && spaceView() });

/** The Who picker's people within the other filters, most bytes on this PC first. */
export const people = pluginResource(plugin, 'people', () => {
  return [{ ...filter(), authorId: undefined, limit: WHO_OPTIONS_MAX }];
}, [] as PersonRow[], { refreshOn: { ...refreshOn, scope }, shown: isShown });
/** The rail's counts, under every filter but the place. */
export const places = pluginResource(plugin, 'places', () => {
  return [unplaced()];
}, { guilds: {}, channels: {}, threads: {} } as AttachmentPlaces, { refreshOn, shown: isShown });
/** This viewer's time zone: months and jumps follow the calendar its dates are shown in, wherever the core runs. */
const viewerZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const months = pluginResource(plugin, 'months', () => [filter(), viewerZone()], [] as AttachmentMonth[], { refreshOn: { ...refreshOn, scope }, shown: isShown });

/**
 * The order's first `limit` rows as shown (from a jumped month's window, while one is open); `reachedStart`: nothing
 * loads above them (bottom-up: the order ends there). `left`: the window held no rows any more, so the order's start was read.
 */
type Read = { items: AttachmentItem[]; reachedStart: boolean; moreBelow: boolean; counts: AttachmentTotals; left?: boolean };
const readNewest = async (limit: number, startAt?: AttachmentCursor, windowed = selectedMonth !== null, signal?: AbortSignal): Promise<Read> => {
  const f = filter();
  const order = sort(), top = topDown();
  const [items, counts] = await Promise.all([page({ ...f, sort: order, limit,
    ...(windowed ? startAt ? { startAt } : { startMonth: selectedMonth!, timeZone: viewerZone() } : {}) }, signal), pluginData(() => desktopCoreClient(plugin, { signal, priority: 'interactive' }).totals(f), emptyTotals())]);
  if (windowed && items.length === 0) return { ...await readNewest(limit, undefined, false, signal), left: true };
  const complete = items.length < limit;
  const prior = windowed ? await page({ ...f, sort: order, limit: 1, before: { ts: items[0]!.ts, id: items[0]!.id } }, signal) : [];
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
      if (kept?.left) { selectedMonth = null; setJumped(false); }
      setFailure(null);
      if (opened || kept?.left) setLoads((n) => n + 1);
    });
  } catch (error) { if (generation === readGeneration) setFailure(String(error)); }
}

/** A filter, order or privacy change: the order's first page replaces the rows, opened where the order starts. */
const reloadWindow = (signal?: AbortSignal): Promise<void> =>
  apply((keep) => list.reload(async (readSignal) => { const r = await readNewest(ATTACHMENT_PAGE_SIZE, undefined, undefined, readSignal); keep(r); return r; }, signal), true);
export const reloadAttachments = coalescedRead((signal?: AbortSignal): Promise<void> => {
  if (!isShown()) return Promise.resolve();
  selectedMonth = null; setJumped(false);
  return reloadWindow(signal);
}, () => JSON.stringify([snapshot(), isShown(), callable(plugin, 'page'), privacyEpoch]));
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
  return apply((keep) => list.update((signal) => readNewest(Math.max(ATTACHMENT_PAGE_SIZE, span), first ? cursorAt(first) : undefined, undefined, signal), (r, items) => {
    // Another window opened meanwhile (a jump, a filter): this read is of the one it replaced, and its own read is fresh.
    if ((topDown() ? items[0] : items.at(-1))?.id !== first?.id) return [...items];
    if (items.length !== span) {
      queueMicrotask(() => void rereadAttachments());
      return [...items];
    }
    keep(r);
    return { items: r.items, reachedStart: r.reachedStart };
  }), false);
};

/** Owner rebuild completion refreshes the visible aggregates through their existing read lifetimes. */
export async function refreshAttachmentAggregates(): Promise<void> {
  if (!isShown()) return;
  await Promise.all([reloadAttachments(), people.refetch(), places.refetch(), months.refetch(), breakdown.refetch()]);
}

containedRoot(() => {
  createEffect(() => selection.retain(attachments.items));
  createEffect(on([where, who, kinds, range, minBytes, presence, uncompressed, repeated, queryName, sort, anchor, isShown, () => callable(plugin, 'page')],
    () => void reloadAttachments(), { defer: true }));
});
onArchiveChange({ ...refreshOn, scope, shown: isShown }, async (change, signal) => {
  await list.applyChange(change, signal);
  if (signal.aborted || ![...change.channelIds].every((id) => change.insertOnly(id))) return;
  const generation = readGeneration;
  const counts = await pluginData(() => desktopCoreClient(plugin, { signal, priority: 'interactive' }).totals(filter()), emptyTotals());
  if (!signal.aborted && generation === readGeneration) setTotals(counts);
});
// Hidden files leave at once, before the reread returns.
onAppEvent('privacy-changed', () => {
  privacyEpoch++;
  selection.clear();
  breakdown.mutate([]);
  list.reset();
  setTotals(emptyTotals());
  void Promise.all([people.refetch(), places.refetch(), months.refetch(), breakdown.refetch()]);
  void reloadAttachments();
});
