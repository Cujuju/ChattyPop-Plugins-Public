// Alerts' inbox, filters and unread counts over the plugin channels.
import { createEffect, createMemo, createSignal } from 'solid-js';
import type { AlertItem, AlertSpan } from '../shared/types';
import { plugin } from '../shared';
import { containedRoot, pluginsLoaded, coreClient, pluginPreference, sameIds, onAppEvent, onEvent, pluginResource } from '@plugin-sdk/renderer';
import { keyedById, openArchive, rules, timeBounds, type TimeWindow } from '@plugin-sdk/renderer/kit';

/** Alerts listed in the Alerts panel. */
const ALERT_PAGE_SIZE = 100;
const api = coreClient(plugin);
/** No alerts: before the plugin list loads, and while this window may not read them. */
const NO_ALERTS: AlertItem[] = [];
/** No unread counts, likewise. */
const NO_COUNTS: Record<number, number> = {};

/** Alerts filter: unread only, or everything. */
export const [alertsUnreadOnly, setAlertsUnreadOnly] = createSignal(false);

/** When the shown alerts arrived; null is any time. */
export const [alertsWindow, setAlertsWindow] = createSignal<TimeWindow | null>(null);
/** The window's span, read at each call so a preset stays its length back from now. */
const shownSpan = (): AlertSpan => {
  const { since, until } = timeBounds(alertsWindow(), Date.now());
  return { ...(since === null ? {} : { sinceTs: since }), ...(until === null ? {} : { untilTs: until }) };
};

/** Alerts in time order, or grouped by rule. */
export const [alertSort, setAlertSort] = pluginPreference(plugin, 'sort');

/** Rules whose alerts the Alerts panel shows; none = every alert. */
const [chosenRuleIds, setChosenRuleIds, filterSetting] = pluginPreference(plugin, 'ruleIds');
export { setChosenRuleIds as setAlertRuleIds };
const [filterLoaded, setFilterLoaded] = createSignal(false);
void filterSetting.loaded.then(() => setFilterLoaded(true));
containedRoot(() => createEffect(() => {
  if (!filterLoaded() || rules.state !== 'ready') return;
  const kept = chosenRuleIds().filter((id) => rules().some((rule) => rule.id === id));
  if (!sameIds(kept, chosenRuleIds())) setChosenRuleIds(kept);
}));
/** The chosen rules that still exist (all chosen ones while the rule list loads). */
export const alertRuleIds = containedRoot(() => createMemo(
  (): number[] => {
    const known = rules();
    return known.length ? chosenRuleIds().filter((id) => known.some((r) => r.id === id)) : chosenRuleIds();
  },
  [],
  { equals: sameIds },
));

/** Read once the plugin list has loaded, so a plugin that is off is never asked. */
export const alerts = pluginResource(
  plugin,
  'alerts',
  () => pluginsLoaded() && [{ limit: ALERT_PAGE_SIZE, unreadOnly: alertsUnreadOnly(), ruleIds: alertRuleIds(), ...shownSpan() }],
  NO_ALERTS,
  { storage: keyedById },
);

const counts = pluginResource(plugin, 'unread', () => pluginsLoaded() && [], NO_COUNTS);
/** Unread counts within the time window, read only while one is set. */
const windowCounts = pluginResource(plugin, 'unread', () => pluginsLoaded() && alertsWindow() !== null && [shownSpan()], NO_COUNTS);
/** Unread alerts belonging to one rule, only while this plugin is active. */
export const ruleUnread = (id: number): number => counts()[id] ?? 0;
export const unreadAlertCount = (): number => rules().reduce((n, r) => n + ruleUnread(r.id), 0);
/** Unread alerts of the rules and time window the Alerts panel shows: what markAllAlertsRead clears. */
export const shownUnreadAlertCount = (): number => {
  const shown = alertRuleIds();
  const unread = alertsWindow() === null ? counts() : windowCounts();
  return rules().reduce((n, r) => n + (shown.length === 0 || shown.includes(r.id) ? unread[r.id] ?? 0 : 0), 0);
};

// Unread counts live on the rules; alerts and counts cover visible channels only.
const refresh = (): void => {
  void alerts.refetch();
  void counts.refetch();
  void windowCounts.refetch();
};
onEvent(plugin, 'changed', refresh);
onAppEvent('privacy-changed', refresh);
onAppEvent('rules-changed', refresh); // a deleted or renamed rule

/** Opens an alert's message in the Archive and marks it read. */
export async function openAlert(a: AlertItem): Promise<void> {
  void openArchive(a.channelId, a.messageId);
  if (a.readAt === null) await api.markRead([a.id]);
}

/** Marks every unread alert of the shown rules and time window read. */
export const markAllAlertsRead = (): Promise<void> => api.markRead(null, alertRuleIds(), shownSpan());
