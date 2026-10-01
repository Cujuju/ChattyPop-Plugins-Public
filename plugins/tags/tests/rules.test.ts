// Tags in the rule engine: tag narrowing reads current tags, and a rule's tag never overrides the owner.
import { beforeEach, describe, expect, it } from 'vitest';
import type { RuleAction } from '@shared/rules';
import { newRuleAction } from '@shared/ruleSpec';
import { ARRIVAL } from '@core/arrival';
import { settleAsync } from '@chattypop/host-testing';
import { ruleHarness, ruleInput, runsOf, type Harness } from './ruleHarness';

let h: Harness;
let tagId: number;
beforeEach(() => {
  h = ruleHarness();
  tagId = h.tags.create({ name: 'flag', jevQuestion: null, auto: false });
});

const tag = (): RuleAction => ({ ...newRuleAction('tags.apply'), config: { tagId } }) as RuleAction;
const tagged = (messageId: string): boolean =>
  h.tags.forMessage(messageId).some((c) => c.tagId === tagId && c.source === 'rule');

describe('rule engine', () => {
  it('a tag narrowing reads the tags a message carries now', async () => {
    const other = h.tags.create({ name: 'other', jevQuestion: null, auto: false });
    const id = h.rules.create(ruleInput([tag()], { gates: { edits: true }, narrow: { tagIds: [other] } }));
    const m = h.say('first');
    h.tags.setManual(m.id, other, true);
    h.archive.ingestMessages([{ ...m, content: 'edited' }], ARRIVAL.gateway);
    await settleAsync();
    expect(runsOf(h, id).map((r) => r[0])).toEqual([m.id]);
  });

  it("a rule's tag never overrides the owner taking it off", async () => {
    const id = h.rules.create(
      ruleInput([tag()], { gates: { edits: true }, match: { text: { pattern: 'cjj', spec: null } } }),
    );
    const m = h.say('hello');
    h.tags.setManual(m.id, tagId, false);
    h.archive.ingestMessages([{ ...m, content: 'hello cjj' }], ARRIVAL.gateway);
    await settleAsync();
    expect(tagged(m.id)).toBe(false);
    expect(runsOf(h, id)).toEqual([[m.id, true, ['skipped']]]);
  });
});
