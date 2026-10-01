// Alert rule declarations, kept together for extraction into the Alerts plugin.
import { DEFAULT_ALERT_COOLDOWN_MS, NOTIFY_DEVICES, type NotifyDevice } from './types';
import { AFTER_MESSAGE, type RuleActionKind, type RuleSpec, type RuleMatchKind } from '@plugin-sdk/shared';

/** A device's notifications from one Alert: at most once per cooldown, or null for none. */
export type DeviceNotify = { cooldownMs: number } | null;

/** An entry in Alerts; `toast` notifies this PC, `phone` the paired phones. Saved before phones had their own: follows `toast`. */
export interface NotifyConfig {
  toast: DeviceNotify;
  phone?: DeviceNotify;
}

/** An Alert's notifications by device. */
export const notifyDevices = (c: NotifyConfig): Record<NotifyDevice, DeviceNotify> => ({
  desktop: c.toast,
  phone: c.phone === undefined ? c.toast : c.phone,
});

/** Records an alert at match time, including read history for older messages. */
export const notify: RuleActionKind<NotifyConfig, 'alerts.notify'> = {
  ...AFTER_MESSAGE,
  type: 'alerts.notify',
  defaultForNewRule: true,
  before: 'summaries.summarize',
  label: 'Alert',
  hint: 'An entry in Alerts, and optionally a notification on this PC and your phones.',
  phase: 'match',
  history: true,
  create: () => ({ toast: { cooldownMs: DEFAULT_ALERT_COOLDOWN_MS }, phone: { cooldownMs: DEFAULT_ALERT_COOLDOWN_MS } }),
  validate(c) {
    const devices = notifyDevices(c);
    if (NOTIFY_DEVICES.some((d) => devices[d] && !(devices[d].cooldownMs >= 0))) throw new Error('Pick how often the rule may notify.');
  },
};

/** The managed match for messages addressed to the owner. */
export const aimed: RuleMatchKind<null, 'alerts.aimed'> = {
  type: 'alerts.aimed',
  after: 'jev',
  label: 'Addressed to you',
  hint: '',
  asksJev: true,
  create: () => null,
  validate() {},
};

/** The managed match for unanswered questions from other people. */
export const openQuestion: RuleMatchKind<null, 'alerts.openQuestion'> = {
  type: 'alerts.openQuestion',
  after: 'alerts.aimed',
  label: 'Unanswered questions',
  hint: '',
  asksJev: true,
  create: () => null,
  validate() {},
};

/** Stored managed-rule keys mapped to their fixed v4 match kinds. */
export const BUILTIN_MATCH: Readonly<Record<string, string>> = {
  aimed_at_me: 'alerts.aimed',
  open_questions: 'alerts.openQuestion',
} as const;

/** A managed alert rule keeps its declared message match and has no narrowing. */
export const managedMatch = (type: string) => (spec: RuleSpec): void => {
  if (spec.trigger.type !== 'message' || spec.match.length !== 1 || spec.match[0]?.type !== type || spec.match[0]?.config !== null || spec.narrow.length)
    throw new Error('The rule could not be read.');
};
