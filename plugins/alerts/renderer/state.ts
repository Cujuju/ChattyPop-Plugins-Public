// Alerts' inbox, filters and unread counts over the plugin channels.
import { createEffect, createMemo, createSignal } from 'solid-js';
import type { AlertItem } from '../shared/types';
import { plugin } from '../shared';
import { pluginsLoaded, coreClient, pluginPreference, sameIds, onAppEvent, onEvent, pluginResource } from '@plugin-sdk/renderer';
import { keyedById, openArchive, rules } from '@plugin-sdk/renderer/kit';

/** Alerts listed in the Alerts panel. */
const ALERT_PAGE_SIZE = 100;
const api = coreClient(plugin);
/** No alerts: before the plugin list loads, and while this window may not read them. */
const NO_ALERTS: AlertItem[] = [];
/** No unread counts, likewise. */
const NO_COUNTS: Record<number, number> = {};

/** Alerts filter: unread only, or everything. */
export const [alertsUnreadOnly, setAlertsUnreadOnly] = createSignal(false);

/** Alerts in time order, or grouped by rule. */
export const [alertSort, setAlertSort] = pluginPreference(plugin, 'sort');

/** Rules whose alerts the Alerts panel shows; none = every alert. */
const [chosenRuleIds, setChosenRuleIds, filterSetting] = pluginPreference(plugin, 'ruleIds');
export { setChosenRuleIds as setAlertRuleIds };
const [filterLoaded, setFilterLoaded] = createSignal(false);
void filterSetting.loaded.then(() => setFilterLoaded(true));
createEffect(() => {
  if (!filterLoaded() || rules.state !== 'ready') return;
  const kept = chosenRuleIds().filter((id) => rules().some((rule) => rule.id === id));
  if (!sameIds(kept, chosenRuleIds())) setChosenRuleIds(kept);
});
/** The chosen rules that still exist (all chosen ones while the rule list loads). */
export const alertRuleIds = createMemo(
  (): number[] => {
    const known = rules();
    return known.length ? chosenRuleIds().filter((id) => known.some((r) => r.id === id)) : chosenRuleIds();
  },
  [],
  { equals: sameIds },
);

/** Read once the plugin list has loaded, so a plugin that is off is never asked. */
export const alerts = pluginResource(
  plugin,
  'alerts',
  () => pluginsLoaded() && [{ limit: ALERT_PAGE_SIZE, unreadOnly: alertsUnreadOnly(), ruleIds: alertRuleIds() }],
  NO_ALERTS,
  { storage: keyedById },
);

const counts = pluginResource(plugin, 'unread', () => pluginsLoaded() && [], NO_COUNTS);
/** Unread alerts belonging to one rule, only while this plugin is active. */
export const ruleUnread = (id: number): number => counts()[id] ?? 0;
export const unreadAlertCount = (): number => rules().reduce((n, r) => n + ruleUnread(r.id), 0);
/** Unread alerts of the rules the Alerts panel shows: what markAllAlertsRead clears. */
export const shownUnreadAlertCount = (): number => {
  const shown = alertRuleIds();
  return rules().reduce((n, r) => n + (shown.length === 0 || shown.includes(r.id) ? ruleUnread(r.id) : 0), 0);
};

// Unread counts live on the rules; alerts and counts cover visible channels only.
const refresh = (): void => {
  void alerts.refetch();
  void counts.refetch();
};
onEvent(plugin, 'changed', refresh);
onAppEvent('privacy-changed', refresh);
onAppEvent('rules-changed', refresh); // a deleted or renamed rule

/** Opens an alert's message in the Archive and marks it read. */
export async function openAlert(a: AlertItem): Promise<void> {
  void openArchive(a.channelId, a.messageId);
  if (a.readAt === null) await api.markRead([a.id]);
}

/** Marks every unread alert of the shown rules read. */
export const markAllAlertsRead = (): Promise<void> => api.markRead(null, alertRuleIds());
