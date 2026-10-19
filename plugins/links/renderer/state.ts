// The Links panel's state: its filter, the paged feed, and the "new since you looked" watermark.
import { createEffect, createSignal, on } from 'solid-js';
import { type Platform } from '@plugin-sdk/shared';
import {
  batchWrites,
  callable,
  containedRoot,
  coalescedRead,
  coreClient,
  pluginData,
  onAppEvent,
  onArchiveChange,
  panelShown,
  onCleanup,
  onEvent,
  onMessagePartsChanged,
  pluginPreference,
} from '@plugin-sdk/renderer';
import { createPagedList, inCompanion, timeBounds, type RailPlace, type TimeWindow } from '@plugin-sdk/renderer/kit';
export { linkDivider, newLinkCount, markLinksSeen, onLinksShown } from './seen';
import { refreshNewCount } from './seen';
import { UPDATED_EVENT, plugin } from '../shared';
import type { LinkCursor, LinkFilter, LinkItem, LinkPlace, LinkSort, LinkWindow } from '../shared/types';

/** Items fetched per page of the Links panel's history. */
const LINK_PAGE_SIZE = 100;
/** Links read on each side of a restored place: a page in all. */
const PLACE_SIDE_LINKS = LINK_PAGE_SIZE / 2;

/** The feed's calls, from the desktop's Links panel or the phone's Links section; they run while feedOn. */
const client = coreClient(plugin);
const isShown = panelShown('links');
let privacyEpoch = 0;
const core = {
  page: (query: Parameters<typeof client.page>[0], signal?: AbortSignal) => pluginData(() => coreClient(plugin, { signal, priority: isShown() ? 'interactive' : 'background' }).page(query), []),
  window: (query: Parameters<typeof client.window>[0], signal?: AbortSignal) => pluginData(() => coreClient(plugin, { signal, priority: isShown() ? 'interactive' : 'background' }).window(query), NO_WINDOW),
  counts: (query: Parameters<typeof client.counts>[0], signal?: AbortSignal) => pluginData(() => coreClient(plugin, { signal, priority: isShown() ? 'interactive' : 'background' }).counts(query), {}),
};
/** The window while Links is off: nothing loaded, nothing beyond. */
const NO_WINDOW: LinkWindow = { items: [], reachesNewest: true, reachedStart: true, anchorId: null };
/** Core pages newest first; the panel lists oldest first (newest at the bottom). */
const oldestFirst = (page: LinkItem[]): LinkItem[] => [...page].reverse();
/** The feed's calls are served while the plugin is on. Reactive. */
const feedOn = (): boolean => callable(plugin, 'page');

// --- Filter ------------------------------------------------------------------

export const [linkPlatforms, setLinkPlatforms] = createSignal<Platform[]>([]);
/** Where links were first shared: a server or one channel (with its threads); null is everywhere. */
export const [linkWhere, setLinkWhere] = createSignal<RailPlace | null>(null, { equals: (a, b) => a?.by === b?.by && a?.id === b?.id });
/** The desktop rail's channel column is folded away. */
export const [linkChannelsHidden, setLinkChannelsHidden] = pluginPreference(plugin, 'channelsHidden');
/** When links were shared; null is any time. */
export const [linkWindow, setLinkWindow] = createSignal<TimeWindow | null>(null);
/** Newest first, or most worth reading first (#63). Either way the panel lists the top item last (at the bottom). */
export const [linkSort, setLinkSort] = createSignal<LinkSort>('newest');
/** Leave out links Jev flagged as spam, a scam or NSFW (#62). */
export const [linkHideFlagged, setLinkHideFlagged] = createSignal(false);

/** How many filters are off their defaults: platforms (as one), place, time window, order and flagged (the phone's sheet holds them). */
export const linkFilterCount = (): number =>
  [linkPlatforms().length > 0, linkWhere() !== null, linkWindow() !== null, linkSort() !== 'newest', linkHideFlagged()].filter(Boolean).length;

/** Puts every filter back; one reload follows. */
export function resetLinkFilters(): void {
  batchWrites(() => {
    setLinkPlatforms([]);
    setLinkWhere(null);
    setLinkWindow(null);
    setLinkSort('newest');
    setLinkHideFlagged(false);
  });
}

function filter(): LinkFilter {
  // Read at each load, so a preset stays its length back from now; sinceTs is exclusive, the window's start inclusive.
  const { since, until } = timeBounds(linkWindow(), Date.now());
  const place = linkWhere();
  return {
    ...(linkPlatforms().length ? { platforms: linkPlatforms() } : {}),
    ...(place ? (place.by === 'channel' ? { channelId: place.id } : { guildId: place.id }) : {}),
    ...(since !== null ? { sinceTs: since - 1 } : {}),
    ...(until !== null ? { untilTs: until } : {}),
    ...(linkHideFlagged() ? { hideFlagged: true } : {}),
  };
}

// --- History -----------------------------------------------------------------

/** The cursor after a loaded item, in the current sort. */
const cursorAt = (i: LinkItem | LinkPlace): LinkCursor => ({ ts: i.ts, id: i.id, ...(linkSort() === 'worth' ? { worth: i.worth ?? -1 } : {}) });
/** A place at a loaded item: its cursor, and its bottom edge above the view's. */
export const placeAt = (i: LinkItem, bottom: number): LinkPlace => ({ ...cursorAt(i), bottom });

const list = createPagedList<LinkItem>(
  LINK_PAGE_SIZE,
  async (oldest, signal) => oldestFirst(await core.page({ ...filter(), sort: linkSort(), limit: LINK_PAGE_SIZE, after: cursorAt(oldest) }, signal)),
  async (newest, signal) => oldestFirst(await core.page({ ...filter(), sort: linkSort(), limit: LINK_PAGE_SIZE, before: cursorAt(newest) }, signal)),
  { chronological: () => linkSort() === 'newest', atNewest: () => linkAtNewest(), reload: (signal) => reloadsStarted === 0 && !inCompanion ? reloadAtStoredPlace(signal) : reloadLinks(null, signal) },
);
/** Loaded links oldest first; `reachedStart` once the oldest matching link is loaded. */
export const links = list.state;
/** Prepends the previous (older) page; returns how many links were added (the view keeps its scroll anchor). */
export const loadOlderLinks = list.loadOlder;

/** The loaded links reach the newest: false after opening at a place, until paged down to it. Arrivals land only when true. */
export const [linkAtNewest, setLinkAtNewest] = createSignal(true);

/** Appends the next newer page; a short one reaches the newest. */
export async function loadNewerLinks(): Promise<void> {
  const added = await list.loadNewer();
  if (added !== null && added < LINK_PAGE_SIZE) setLinkAtNewest(true);
}

/** Links per platform matching the current filter. */
const [linkCounts, setLinkCounts] = createSignal<Partial<Record<Platform, number>>>({});
export { linkCounts };

/** Reloads begun: a later one supersedes a stored place still being read. */
let reloadsStarted = 0;
/** Bumped when a reload completes, so the panel places it: at `linkOpening`, else at the newest link. */
export const [linkLoads, setLinkLoads] = createSignal(0);
/** The place the last reload opened at, and the loaded link standing for it (its own, or its nearest); null: the newest. */
export const [linkOpening, setLinkOpening] = createSignal<{ place: LinkPlace; anchorId: number | null } | null>(null);

/** Reloads the counts and the newest page for the current filter, or the links around `place`. */
export const reloadLinks = coalescedRead(async (place: LinkPlace | null = null, signal?: AbortSignal): Promise<void> => {
  reloadsStarted++;
  if (!feedOn() || !isShown()) return;
  const f = filter();
  const sort = linkSort();
  let counts: Partial<Record<Platform, number>> = {};
  let loaded: LinkWindow | undefined;
  const done = await list.reload(async (readSignal) => {
    const read = place
      ? core.window({ ...f, sort, around: cursorAt(place), newer: PLACE_SIDE_LINKS, older: PLACE_SIDE_LINKS }, readSignal)
      : core.page({ ...f, sort, limit: LINK_PAGE_SIZE }, readSignal).then((items) => ({ items, reachesNewest: true, reachedStart: items.length < LINK_PAGE_SIZE, anchorId: null }));
    [loaded, counts] = await Promise.all([read, core.counts(f, readSignal)]);
    return { items: oldestFirst(loaded.items), reachedStart: loaded.reachedStart };
  }, signal);
  if (!done || !loaded) return;
  const { reachesNewest, anchorId } = loaded;
  batchWrites(() => {
    setLinkCounts(counts);
    setLinkAtNewest(reachesNewest);
    setLinkOpening(place && { place, anchorId });
    setLinkLoads((n) => n + 1);
  });
}, (place: LinkPlace | null = null) => JSON.stringify([place, isShown(), feedOn(), privacyEpoch, linkPlatforms(), linkChannelId(), linkWindow(), linkSort(), linkHideFlagged()]));

/** Reads the loaded links again in place (chips, judgments, cards); `withCounts` reads the platform counts too. */
function rereadLoaded(withCounts: boolean): void {
  const loaded = links.items;
  const oldest = loaded[0];
  if (!oldest) return;
  const f = filter();
  let counts: Partial<Record<Platform, number>> | undefined;
  void list.update(
    async () => {
      // From the oldest loaded link up through as many newer: the loaded stretch.
      const [w, c] = await Promise.all([core.window({ ...f, sort: linkSort(), around: cursorAt(oldest), newer: loaded.length - 1, older: 1 }), withCounts ? core.counts(f) : undefined]);
      counts = c;
      return w.items;
    },
    (page, items) => {
      const byId = new Map(page.map((i) => [i.id, i]));
      return items.map((i) => byId.get(i.id) ?? i);
    },
  ).then((applied) => applied && counts && setLinkCounts(counts));
}

/** The panel's reader of where the owner is: undefined while unknown (no panel, a reload landing). */
let placeReader: () => LinkPlace | undefined = () => undefined;
export const linkPlace = (): LinkPlace | undefined => placeReader();
/** Sets the panel's place reader; returns its removal. */
export function readLinkPlaceWith(read: () => LinkPlace | undefined): () => void {
  placeReader = read;
  return () => {
    if (placeReader === read) placeReader = () => undefined;
  };
}

/** Reloads where the owner is: a reload they didn't ask for never moves them. */
const reloadInPlace = (): Promise<void> => reloadLinks(linkPlace() ?? null);

onAppEvent('privacy-changed', () => {
  privacyEpoch++;
  list.reset();
  setLinkCounts({});
  void refreshNewCount();
  void reloadInPlace();
});

/** New links, judgments or fetched X posts: the count and the loaded feed catch up. */
function refresh(): void {
  void refreshNewCount();
  if (!links.items.length || !feedOn() || !isShown()) return;
  // Worth order may move any link: reload around where the owner is.
  if (linkSort() === 'worth') return void reloadInPlace();
  // Opened at a place: newer links page in as the owner nears them; the loaded ones catch up in place.
  if (!linkAtNewest()) return rereadLoaded(true);
  // Newest-order refreshes replace the latest page and preserve older loaded links.
  const f = filter();
  let counts: Partial<Record<Platform, number>> = {};
  void list.update(
    async () => {
      const [page, c] = await Promise.all([core.page({ ...f, limit: LINK_PAGE_SIZE }), core.counts(f)]);
      counts = c;
      return oldestFirst(page);
    },
    (newest, items) => {
      const boundary = newest[0];
      const older = boundary ? items.filter((i) => i.ts < boundary.ts || (i.ts === boundary.ts && i.id < boundary.id)) : [];
      return [...older, ...newest];
    },
  ).then((applied) => applied && setLinkCounts(counts));
}

onArchiveChange({ kinds: ['links', 'deletes', 'names'], scope: () => linkChannelId() ? { channelIds: [linkChannelId()!] } : 'all', shown: isShown }, async (change, signal) => {
  await list.applyChange(change, signal);
  if (signal.aborted || ![...change.channelIds].every((id) => change.insertOnly(id))) return;
  const generation = reloadsStarted;
  const counts = await core.counts(filter(), signal);
  if (!signal.aborted && generation === reloadsStarted) setLinkCounts(counts);
});
containedRoot(() => createEffect(on(isShown, (shown) => { if (shown) void (reloadsStarted === 0 && !inCompanion ? reloadAtStoredPlace() : reloadInPlace()); }, { defer: true })));
onEvent(plugin, UPDATED_EVENT, refresh);

// Chips or notes changed on a loaded link's message (a tag, a transcript): re-read the loaded links in place.
onMessagePartsChanged((ids) => {
  const loaded = links.items;
  if (!feedOn() || !isShown() || !loaded.length || (ids && !loaded.some((i) => ids.includes(i.messageId)))) return;
  rereadLoaded(false);
});

// --- Place -------------------------------------------------------------------

/** Where the desktop's panel last rested; a restart reopens there. */
const [storedPlace, setStoredPlace, { loaded: storedPlaceLoaded }] = pluginPreference(plugin, 'place');
/** Stored once the view rests this long: one settings write per stop, not one per scrolled frame. */
const PLACE_REST_MS = 500;
const samePlace = (a: LinkPlace | null, b: LinkPlace): boolean => a !== null && a.id === b.id && a.ts === b.ts && a.worth === b.worth && a.bottom === b.bottom;

/** Opens the feed where the desktop's panel last rested (the newest when nothing is stored). */
export async function reloadAtStoredPlace(signal?: AbortSignal): Promise<void> {
  const before = reloadsStarted;
  await storedPlaceLoaded;
  if (reloadsStarted === before) await reloadLinks(storedPlace(), signal);
}

/** Desktop: stores where the owner is as it changes; call within the panel's owner. */
export function keepLinkPlace(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  createEffect(() => {
    const place = linkPlace();
    clearTimeout(timer);
    if (place && !samePlace(storedPlace(), place)) timer = setTimeout(() => setStoredPlace(place), PLACE_REST_MS);
  });
}
