import { analyticsResource } from './readResult';
// #85 Analytics panel: what it counts (the rail's place, range and person) and the counts from core.
import { createEffect, createMemo, createSignal, on } from 'solid-js';
import { STATS_PANEL, plugin } from '../shared';
import { POSTERS_PAGE_MAX, STATS_RANGES, placeScope, type ActivityQuery, type StatsPlace, type StatsRange, type StatsSection } from '../shared/types';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { callable, coreClient, onAppEvent, pluginData, pluginPreference, pluginResource, containedRoot, onCleanup, panelShown, visibilitySignal } from '@plugin-sdk/renderer';
import { directory, isThread, shownChannelId } from '@plugin-sdk/renderer/kit';
import { createPosterPages } from './posterPages';
import { listedPerson, resetPerson } from './personSelection';

const [statsPick, setStatsPick] = pluginPreference(plugin, 'place');
/** Where Analytics counts (null: everything). Until the owner picks, the channel shown in the Archive. */
export const statsPlace = containedRoot(() => createMemo((): StatsPlace | null => {
  const pick = statsPick();
  if (pick === 'all') return null;
  if (pick) return pick;
  const shown = shownChannelId();
  return shown ? { by: 'channel', id: shown } : null;
}, null, { equals: (a, b) => a?.by === b?.by && a?.id === b?.id }));
export const setStatsPlace = (place: StatsPlace | null): void => void setStatsPick(place ?? 'all');
export const [statsChannelsHidden, setStatsChannelsHidden] = pluginPreference(plugin, 'channelsHidden');
export const [statsRange, setStatsRange] = pluginPreference(plugin, 'range');
export const [statsSection, setStatsSection] = pluginPreference(plugin, 'section');
/** A person choice lasts only for this renderer session, never a stored preference. */
export const [statsAuthor, setStatsAuthor] = createSignal<string | null>(null);
containedRoot(() => createEffect(on(statsPlace, (next, previous) => {
  setStatsAuthor((authorId) => resetPerson(authorId, previous, next));
})));

/** The channel people are named as in: the place's, or for a server one of its channels (a server names people alike in all). */
export function namesChannelId(): string | null {
  const place = statsPlace();
  if (!place) return null;
  if (place.by === 'channel') return place.id;
  return directory().find((g) => g.id === place.id)?.channels.find((c) => !isThread(c))?.id ?? null;
}

/** Open Analytics panels; counts are only fetched while one is mounted and unfolded (resources defer work while hidden). */
const [mounted, setMounted] = createSignal(0);
export const statsPanelMounted = (): (() => void) => {
  setMounted((n) => n + 1);
  return () => setMounted((n) => n - 1);
};

const isShown = panelShown(STATS_PANEL);

type Choices = { place: StatsPlace | null; range: StatsRange; authorId?: string | null };

function choices(): Choices | undefined {
  if (!mounted() || !isShown()) return undefined;
  return { place: statsPlace(), range: statsRange() };
}

/** The query for `c`. A read takes the range start then (a refetch re-reads its arguments), so a refresh counts up to now. */
const queryOf = (c: Choices): ActivityQuery => {
  const days = STATS_RANGES[c.range].days;
  return { ...placeScope(c.place), sinceTs: days === null ? null : Date.now() - days * MS_PER_DAY, authorId: c.authorId ?? null };
};

const refreshOn = { kinds: ['messages', 'edits', 'deletes', 'attachments', 'links', 'names', 'channels'] as const, shown: () => Boolean(choices()) };

export const personOptions = analyticsResource(pluginResource(plugin, 'postersPage', () => {
  const c = choices();
  return c && [{ ...queryOf(c), offset: 0, limit: POSTERS_PAGE_MAX }];
}, null, { refreshOn }));
containedRoot(() => createEffect(() => {
  const posters = personOptions();
  if (!personOptions.loading && !personOptions.failure && posters) setStatsAuthor((authorId) => listedPerson(authorId, posters));
}));

export const stats = analyticsResource(pluginResource(plugin, 'activityStats', () => {
  const c = choices();
  return c && [queryOf({ ...c, authorId: statsAuthor() })];
}, null, { refreshOn }));
const sectionQuery = (section: StatsSection): [ActivityQuery] | undefined => {
  if (statsSection() !== section) return undefined;
  const c = choices();
  return c && [queryOf({ ...c, authorId: statsAuthor() })];
};

export const emoji = analyticsResource(pluginResource(plugin, 'emojiStats', () => sectionQuery('emoji'), null, { refreshOn }));
export const words = analyticsResource(pluginResource(plugin, 'wordStats', () => sectionQuery('words'), null, { refreshOn }));
export const sentiment = analyticsResource(pluginResource(plugin, 'sentimentStats', () => sectionQuery('sentiment'), null, { refreshOn }));
export const conversations = analyticsResource(pluginResource(plugin, 'conversationStats', () => sectionQuery('conversations'), null, { refreshOn }));
export const people = analyticsResource(pluginResource(plugin, 'peopleStats', () => sectionQuery('people'), null, { refreshOn }));
export const repeats = analyticsResource(pluginResource(plugin, 'repeatedLinks', () => sectionQuery('links'), null, { refreshOn }));
const resources = [stats, emoji, words, sentiment, conversations, people, repeats, personOptions];
export const statsBuild = () => resources.map((r) => r.result()).find((r) => r?.building) ?? null;
export const statsLoading = (): boolean => resources.some((resource) => resource.loading);
export const refreshStats = async (): Promise<void> => {
  await Promise.all(resources.map((resource) => resource.refetch()));
};

const [privacyChanges, setPrivacyChanges] = createSignal(0);

/** Each mounted People section owns its expanded pages. */
export function createPosterList() {
  const signal = visibilitySignal(isShown);
  const pages = createPosterPages(async (q) => {
    const active = signal();
    active.throwIfAborted();
    const call = coreClient(plugin, { signal: active, priority: 'interactive' }).postersPage;
    if (!call) throw new Error('Analytics is unavailable in this window.');
    return (await pluginData(() => call(q), null))?.data ?? [];
  });
  createEffect(on(() => [statsPlace(), statsRange(), stats(), privacyChanges(), callable(plugin, 'postersPage')], pages.reset));
  onCleanup(pages.reset);
  return pages;
}

onAppEvent('privacy-changed', () => {
  setPrivacyChanges((n) => n + 1);
  for (const resource of resources) resource.mutate(null);
  void refreshStats();
});

onAppEvent('rollup-progress', (e) => {
  if (e.pluginId === 'stats' && !e.building) void refreshStats();
});
