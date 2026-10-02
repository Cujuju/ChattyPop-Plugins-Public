// The Links panel's state: its filter, the paged feed, and the "new since you looked" watermark.
import { batch, createEffect, createSignal, on } from 'solid-js';
import { MS_PER_DAY, pluginSetting, type Platform } from '@plugin-sdk/shared';
import {
  ARCHIVE_REFRESH_DEBOUNCE_MS,
  callable,
  coreClient,
  pluginData,
  lastSeenAt,
  onAppEvent,
  onAppEventDebounced,
  onEvent,
  onMessagePartsChanged,
  pluginPreference,
} from '@plugin-sdk/renderer';
import { createPagedList } from '@plugin-sdk/renderer/kit';
import { UPDATED_EVENT, plugin } from '../shared';
import type { LinkCursor, LinkFilter, LinkItem, LinkSort } from '../shared/types';

/** Items fetched per page of the Links panel's history. */
const LINK_PAGE_SIZE = 100;

/** `short`: the range on a segment of the phone's filter sheet. */
export const LINK_RANGES = {
  all: { label: 'Any time', short: 'Any time', days: null },
  '1d': { label: 'Last 24 hours', short: '24 hours', days: 1 },
  '7d': { label: 'Last 7 days', short: '7 days', days: 7 },
  '30d': { label: 'Last 30 days', short: '30 days', days: 30 },
} as const;
export type LinkRange = keyof typeof LINK_RANGES;

/** The feed's calls, from the desktop's Links panel or the phone's Links section; they run while feedOn. */
const client = coreClient(plugin);
const core = {
  page: (query: Parameters<typeof client.page>[0]) => pluginData(() => client.page(query), []),
  counts: (query: Parameters<typeof client.counts>[0]) => pluginData(() => client.counts(query), {}),
  markSeen: () => pluginData(() => client.markSeen(), undefined),
};
const sum = (counts: Partial<Record<Platform, number>>): number => Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
/** Core pages newest first; the panel lists oldest first (newest at the bottom). */
const oldestFirst = (page: LinkItem[]): LinkItem[] => [...page].reverse();
/** The feed's calls are served while the plugin is on. Reactive. */
const feedOn = (): boolean => callable(plugin, 'page');

// --- Filter ------------------------------------------------------------------

export const [linkPlatforms, setLinkPlatforms] = createSignal<Platform[]>([]);
export const [linkChannelId, setLinkChannelId] = createSignal<string | null>(null);
export const [linkRange, setLinkRange] = createSignal<LinkRange>('all');
/** Newest first, or most worth reading first (#63). Either way the panel lists the top item last (at the bottom). */
export const [linkSort, setLinkSort] = createSignal<LinkSort>('newest');
/** Leave out links Jev flagged as spam, a scam or NSFW (#62). */
export const [linkHideFlagged, setLinkHideFlagged] = createSignal(false);

/** How many filters are off their defaults: platforms (as one), channel, range, order and flagged (the phone's sheet holds them). */
export const linkFilterCount = (): number =>
  [linkPlatforms().length > 0, linkChannelId() !== null, linkRange() !== 'all', linkSort() !== 'newest', linkHideFlagged()].filter(Boolean).length;

/** Puts every filter back; one reload follows. */
export function resetLinkFilters(): void {
  batch(() => {
    setLinkPlatforms([]);
    setLinkChannelId(null);
    setLinkRange('all');
    setLinkSort('newest');
    setLinkHideFlagged(false);
  });
}

function filter(): LinkFilter {
  const days = LINK_RANGES[linkRange()].days;
  return {
    ...(linkPlatforms().length ? { platforms: linkPlatforms() } : {}),
    ...(linkChannelId() ? { channelId: linkChannelId()! } : {}),
    ...(days !== null ? { sinceTs: Date.now() - days * MS_PER_DAY } : {}),
    ...(linkHideFlagged() ? { hideFlagged: true } : {}),
  };
}

// --- Seen watermark ----------------------------------------------------------

/**
 * Links first shared after this count as new; advanced while the Links panel is on screen. Null until loaded. First run
 * has no watermark: it starts at the end of the previous app session, like "since you were last here".
 */
const [seenUpTo, , { loaded: watermarkLoaded }] = pluginPreference(plugin, 'seenUpTo', {
  seed: lastSeenAt,
});
/** The watermark as it was when the panel last came on screen: the "caught up" divider sits there. */
export const [linkDivider, setLinkDivider] = createSignal<number | null>(null);
/** Links shared since the watermark, across every filter. */
const [newCount, setNewCount] = createSignal(0);
export { newCount as newLinkCount };

/** Count reads started; only the latest one's answer lands (a privacy change mid-read starts a newer one). */
let countReads = 0;

async function refreshNewCount(): Promise<void> {
  const since = seenUpTo();
  if (!feedOn()) return;
  const read = ++countReads;
  const count = since === null ? 0 : sum(await core.counts({ sinceTs: since }));
  if (read === countReads) setNewCount(count);
}

export function onLinksShown(): void {
  setLinkDivider(seenUpTo());
}

/**
 * Core moves the watermark, so a phone's mark is stored as a desktop window's is. The count clears at once, and a count
 * read begun earlier is dropped; core's setting change then recounts.
 */
export function markLinksSeen(): void {
  if (newCount() === 0 && seenUpTo() !== null) return;
  countReads++;
  setNewCount(0);
  void core.markSeen();
}

// Core or another window moved the watermark (createSetting, registered first, has already adopted it).
onAppEvent('setting-changed', (e) => {
  if (e.key === pluginSetting(plugin, 'seenUpTo')) void refreshNewCount();
});

void watermarkLoaded.then(() => {
  setLinkDivider((d) => d ?? seenUpTo());
  return refreshNewCount();
});

// Turned on while the app runs: count what's new.
createEffect(on(feedOn, (isOn) => isOn && void refreshNewCount(), { defer: true }));

// --- History -----------------------------------------------------------------

/** The cursor after a loaded item, in the current sort. */
const cursorAt = (i: LinkItem): LinkCursor => ({ ts: i.ts, id: i.id, ...(linkSort() === 'worth' ? { worth: i.worth ?? -1 } : {}) });

const list = createPagedList<LinkItem>(LINK_PAGE_SIZE, async (oldest) =>
  oldestFirst(await core.page({ ...filter(), sort: linkSort(), limit: LINK_PAGE_SIZE, after: cursorAt(oldest) })),
);
/** Loaded links oldest first; `reachedStart` once the oldest matching link is loaded. */
export const links = list.state;
/** Prepends the previous (older) page; returns how many links were added (the view keeps its scroll anchor). */
export const loadOlderLinks = list.loadOlder;

/** Links per platform matching the current filter. */
const [linkCounts, setLinkCounts] = createSignal<Partial<Record<Platform, number>>>({});
export { linkCounts };

/** Bumped when a reload completes, so the panel scrolls to its newest link. */
export const [linkLoads, setLinkLoads] = createSignal(0);

/** Reloads the newest page and the counts for the current filter. */
export async function reloadLinks(): Promise<void> {
  if (!feedOn()) return;
  const f = filter();
  let counts: Partial<Record<Platform, number>> = {};
  const done = await list.reload(async () => {
    const [items, c] = await Promise.all([core.page({ ...f, sort: linkSort(), limit: LINK_PAGE_SIZE }), core.counts(f)]);
    counts = c;
    return { items: oldestFirst(items), reachedStart: items.length < LINK_PAGE_SIZE };
  });
  if (!done) return;
  setLinkCounts(counts);
  setLinkLoads((n) => n + 1);
}

onAppEvent('privacy-changed', () => {
  void refreshNewCount();
  void reloadLinks();
});

/** New links, judgments or fetched X posts: the count and the loaded feed catch up. */
function refresh(): void {
  void refreshNewCount();
  if (!links.items.length || !feedOn()) return;
  // Worth order shifts as links are judged: reload it. Newest order keeps the older links already loaded; the newest
  // page replaces the rest, new links landing at the bottom.
  if (linkSort() === 'worth') return void reloadLinks();
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

onAppEventDebounced('archive-changed', ARCHIVE_REFRESH_DEBOUNCE_MS, refresh);
onEvent(plugin, UPDATED_EVENT, refresh);

// Chips or notes changed on a loaded link's message (a tag, a transcript): re-read the loaded links in place.
onMessagePartsChanged((ids) => {
  const loaded = links.items;
  if (!feedOn() || !loaded.length || (ids && !loaded.some((i) => ids.includes(i.messageId)))) return;
  const f = filter();
  void list.update(
    () => core.page({ ...f, sort: linkSort(), limit: loaded.length }),
    (page, items) => {
      const byId = new Map(page.map((i) => [i.id, i]));
      return items.map((i) => byId.get(i.id) ?? i);
    },
  );
});
