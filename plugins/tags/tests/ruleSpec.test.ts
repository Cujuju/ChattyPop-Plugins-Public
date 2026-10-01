// Tags' rule kinds refuse a rule that names no tag.
import { describe, expect, it } from 'vitest';
import type { RuleInput, RuleSpec } from '@shared/rules';
import { newRuleAction, newRuleInput, validateRuleInput } from '@shared/ruleSpec';

const input = (over: Partial<RuleSpec> = {}): RuleInput => {
  const base = newRuleInput();
  return { ...base, name: 'R', spec: { ...base.spec, ...over } };
};

describe('rule spec', () => {
  it('rejects an empty tag trigger and a tag action without a tag', () => {
    expect(() =>
      validateRuleInput(input({ trigger: { type: 'tags.applied', config: { tagIds: [], sources: ['jev'] } } })),
    ).toThrow(/Pick the tags/);
    expect(() => validateRuleInput(input({ actions: [newRuleAction('tags.apply')] }))).toThrow(/tag to apply/);
  });
});
