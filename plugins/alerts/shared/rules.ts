// Alert rule declarations, kept together for extraction into the Alerts plugin.
import { DEFAULT_ALERT_COOLDOWN_MS } from './types';
import { AFTER_MESSAGE, type RuleActionKind, type RuleSpec, type RuleMatchKind } from '@plugin-sdk/shared';

/** An entry in Alerts; toast enables live desktop notifications at most once per cooldown, or null disables them. */
export interface NotifyConfig {
  toast: { cooldownMs: number } | null;
}

/** Records an alert at match time, including read history for older messages. */
export const notify: RuleActionKind<NotifyConfig, 'alerts.notify'> = {
  ...AFTER_MESSAGE,
  type: 'alerts.notify',
  defaultForNewRule: true,
  before: 'summaries.summarize',
  label: 'Alert',
  hint: 'An entry in Alerts, and optionally a desktop notification.',
  phase: 'match',
  history: true,
  create: () => ({ toast: { cooldownMs: DEFAULT_ALERT_COOLDOWN_MS } }),
  validate(c) {
    if (c.toast && !(c.toast.cooldownMs >= 0)) throw new Error('Pick how often the rule may notify.');
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
