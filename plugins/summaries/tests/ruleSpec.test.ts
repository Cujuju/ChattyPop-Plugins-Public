// The summarize rule action in the host's rule spec: its own prompts checked, and runs on missed messages.
import { describe, expect, it } from 'vitest';
import { runsOnMissed, type RuleInput, type RuleSpec } from '@shared/rules';
import { newRuleAction, newRuleInput, validateRuleInput } from '@shared/ruleSpec';

const input = (over: Partial<RuleSpec> = {}, discordSend = false): RuleInput => {
  const base = newRuleInput();
  return { ...base, name: 'R', discordSend, spec: { ...base.spec, ...over } };
};

describe('rule spec', () => {
  it("checks a summarize action's own prompts like Settings does", () => {
    const own = (summarize: string | null, merge: string | null) =>
      input({
        actions: [
          {
            ...newRuleAction('summaries.summarize'),
            config: { lookbackMs: 1, prompts: { summarize, merge } },
          } as never,
        ],
      });
    expect(() => validateRuleInput(own('Short. {refs}', null))).not.toThrow();
    expect(() => validateRuleInput(own(null, 'No citations here.'))).toThrow(/Merge prompt: Keep \{refs\}/);
    expect(() => validateRuleInput(own('{refs} {nope}', null))).toThrow(
      /Summarize prompt: \{nope\} isn't a placeholder/,
    );
  });

  it('a summarize action acts on missed messages', () => {
    expect(runsOnMissed(newRuleAction('summaries.summarize'))).toBe(true);
  });
});
