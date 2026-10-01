// #85 Activity panel: what it counts (scope follows the shown channel) and the counts from core.
import { createSignal } from 'solid-js';
import { STATS_PANEL, plugin } from '../shared';
import { STATS_RANGES, type ActivityQuery, type StatsRange, type StatsScope } from '../shared/types';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { onAppEvent, pluginPreference, pluginResource } from '@plugin-sdk/renderer';
import { isPanelCollapsed, shownChannelId } from '@plugin-sdk/renderer/kit';

export const [statsScope, setStatsScope] = pluginPreference(plugin, 'scope');
export const [statsRange, setStatsRange] = pluginPreference(plugin, 'range');

/** Open Activity panels; counts are only fetched while one is mounted and unfolded (a whole-archive count is a full scan). */
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
export const refreshStats = (): Promise<void> => stats.refetch();

onAppEvent('privacy-changed', () => void refreshStats());
