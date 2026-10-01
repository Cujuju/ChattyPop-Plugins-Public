// Factories for the original scheduled-summary rules.
import { newGates, RULE_SPEC_VERSION, type RuleInput, type TimedTrigger } from '@plugin-sdk/shared';
import { summarize } from './rules';

/** #96 a rule that summarizes its channels on a schedule; the catch-up and digest settings became these. */
export const timedSummaryInput = (name: string, trigger: TimedTrigger, enabled = true): RuleInput => ({
  name,
  enabled,
  discordSend: false,
  spec: {
    v: RULE_SPEC_VERSION,
    trigger: { type: 'timed', config: trigger },
    gates: newGates(),
    match: [],
    narrow: [],
    actions: [{ id: crypto.randomUUID(), type: summarize.type, config: summarize.create() }],
  },
});
