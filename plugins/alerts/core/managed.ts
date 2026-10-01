// #89 built-in rules: "Aimed at you" and "Open questions", created and switched by their Settings → Jev toggles.
import { RULE_SPEC_VERSION, MESSAGE_TRIGGER, type RuleInput } from '@plugin-sdk/shared';
import type { AlertFeature } from '../shared/queries';
import type { ManagedRule } from '@plugin-sdk/core';
import { BUILTIN_MATCH } from '../shared/rules';
import { DEFAULT_ALERT_COOLDOWN_MS, ALERT_COOLDOWNS } from '../shared/types';

/** Rules ChattyPop creates and switches with a Settings → Jev toggle; their match is fixed, the rest is the owner's. */
const BUILTIN_RULES = ['aimed_at_me', 'open_questions'] as const;
type BuiltinRule = (typeof BUILTIN_RULES)[number];
/** The managed rule whose alerts a later reply marks read (#54). */
export const OPEN_QUESTIONS: BuiltinRule = 'open_questions';
/** The Settings → Jev switch that owns each built-in rule's on/off. */
const BUILTIN_FEATURE: Readonly<Record<BuiltinRule, AlertFeature>> = {
  aimed_at_me: 'aimedAtMe',
  open_questions: 'unansweredQuestions',
};

const BUILTIN_DEFAULTS: Readonly<Record<BuiltinRule, { name: string; cooldownMs: number }>> = {
  aimed_at_me: { name: 'Aimed at you', cooldownMs: DEFAULT_ALERT_COOLDOWN_MS },
  // Questions come often; the longest cooldown keeps them from becoming a stream of notifications.
  open_questions: { name: 'Open questions', cooldownMs: Math.max(...ALERT_COOLDOWNS.map((c) => c.ms)) },
};

/** A new built-in rule: every archived channel, missed messages too, alerting with its default cooldown. */
const builtinInput = (b: BuiltinRule): RuleInput => ({
  name: BUILTIN_DEFAULTS[b].name,
  enabled: true,
  discordSend: false,
  spec: {
    v: RULE_SPEC_VERSION,
    trigger: { type: MESSAGE_TRIGGER, config: null },
    gates: { edits: false, missed: true },
    match: [{ type: BUILTIN_MATCH[b]!, config: null }],
    narrow: [],
    actions: [
      { id: 'alert', type: 'alerts.notify', config: { toast: { cooldownMs: BUILTIN_DEFAULTS[b].cooldownMs } } },
    ],
  },
});

/** Each managed alert rule follows its Settings toggle; `isOn` reads Alerts' switches. */
export const builtinRules = (isOn: (feature: AlertFeature) => boolean): ManagedRule[] =>
  BUILTIN_RULES.map((key) => ({ key, enabled: isOn(BUILTIN_FEATURE[key]), input: () => builtinInput(key) }));
