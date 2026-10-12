// #85 Analytics panel: what it counts (scope follows the shown channel) and the counts from core.
import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { STATS_PANEL, plugin } from '../shared';
import { STATS_RANGES, type ActivityQuery, type StatsRange, type StatsScope, type StatsSection } from '../shared/types';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { callable, coreClient, onAppEvent, pluginData, pluginPreference, pluginResource } from '@plugin-sdk/renderer';
import { isPanelCollapsed, shownChannelId } from '@plugin-sdk/renderer/kit';
import { createPosterPages } from './posterPages';

export const [statsScope, setStatsScope] = pluginPreference(plugin, 'scope');
export const [statsRange, setStatsRange] = pluginPreference(plugin, 'range');
export const [statsSection, setStatsSection] = pluginPreference(plugin, 'section');

/** Open Analytics panels; counts are only fetched while one is mounted and unfolded (a whole-archive count is a full scan). */
const [mounted, setMounted] = createSignal(0);
export const statsPanelMounted = (): (() => void) => {
  setMounted((n) => n + 1);
  return () => setMounted((n) => n - 1);
};

type Choices = { scope: StatsScope; channelId: string | null; range: StatsRange };

function choices(): Choices | undefined {
  if (!mounted() || isPanelCollapsed(STATS_PANEL)) return undefined;
  return { scope: statsScope(), channelId: shownChannelId(), range: statsRange() };
}

/** The query for `c`. A read takes the range start then (a refetch re-reads its arguments), so a refresh counts up to now. */
const queryOf = (c: Choices): ActivityQuery => {
  const days = STATS_RANGES[c.range].days;
  return { scope: c.scope, channelId: c.channelId, sinceTs: days === null ? null : Date.now() - days * MS_PER_DAY };
};

export const stats = pluginResource(plugin, 'activityStats', () => {
  const c = choices();
  return c && [queryOf(c)];
}, null);
const sectionQuery = (section: StatsSection): [ActivityQuery] | undefined => {
  if (statsSection() !== section) return undefined;
  const c = choices();
  return c && [queryOf(c)];
};

export const emoji = pluginResource(plugin, 'emojiStats', () => sectionQuery('emoji'), null);
export const words = pluginResource(plugin, 'wordStats', () => sectionQuery('words'), null);
export const statsLoading = (): boolean => stats.loading || emoji.loading || words.loading;
export const refreshStats = async (): Promise<void> => { await Promise.all([stats.refetch(), emoji.refetch(), words.refetch()]); };

const [privacyChanges, setPrivacyChanges] = createSignal(0);

/** Each mounted People section owns its expanded pages. */
export function createPosterList() {
  const pages = createPosterPages(async (q) => {
    const call = coreClient(plugin).postersPage;
    if (!call) throw new Error('Analytics is unavailable in this window.');
    return pluginData(() => call(q), []);
  });
  createEffect(on(() => [statsScope(), statsRange(), shownChannelId(), stats(), privacyChanges(), callable(plugin, 'postersPage')], pages.reset));
  onCleanup(pages.reset);
  return pages;
}

onAppEvent('privacy-changed', () => {
  setPrivacyChanges((n) => n + 1);
  void refreshStats();
});
