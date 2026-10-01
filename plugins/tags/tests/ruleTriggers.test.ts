// Manual and Jev tag triggers, deduplication and the no-chaining guard.
import { beforeEach, describe, expect, it } from 'vitest';
import { tagSubject } from '../shared/types';
import type { RuleAction } from '@shared/rules';
import { newRuleAction } from '@shared/ruleSpec';
import { settleAsync } from '@chattypop/host-testing';
import { ruleHarness, ruleInput, runsOf, type Harness } from './ruleHarness';

let h: Harness;
let mark: number;
let flag: number;
beforeEach(() => {
  h = ruleHarness();
  mark = h.tags.create({ name: 'mark', jevQuestion: null, auto: false });
  flag = h.tags.create({
    name: 'flag',
    jevQuestion: { type: 'noul', question: 'Is it a sale?', yes: '', no: '', minProbability: 0.5 },
    auto: true,
  });
});

const tag = (tagId: number): RuleAction => ({ ...newRuleAction('tags.apply'), config: { tagId } }) as RuleAction;

describe('rule triggers', () => {
  it('a tag the owner applies starts rules that take manual tags', async () => {
    const manual = h.rules.create(
      ruleInput([tag(flag)], { trigger: { kind: 'tagApplied', tagIds: [mark], sources: ['manual'] } }),
    );
    const byJev = h.rules.create(
      ruleInput([tag(flag)], { trigger: { kind: 'tagApplied', tagIds: [mark], sources: ['jev'] } }),
    );
    const m = h.say('hello');
    h.tags.setManual(m.id, mark, true);
    h.tags.setManual(m.id, mark, true); // again: the rule already fired on it
    await settleAsync();
    expect(runsOf(h, manual)).toEqual([[m.id, true, ['done']]]);
    expect(runsOf(h, byJev)).toEqual([]);
  });

  it('a tag Jev applies to a live message starts rules that take Jev tags', async () => {
    h.jev.on['tags.customTags'] = true;
    const id = h.rules.create(
      ruleInput([tag(mark)], { trigger: { kind: 'tagApplied', tagIds: [flag], sources: ['jev'] } }),
    );
    h.jev.values = { [tagSubject(flag)]: 0.9 };
    const m = h.say('50% off today');
    await settleAsync();
    expect(runsOf(h, id)).toEqual([[m.id, true, ['done']]]);
  });

  it("a rule's own tag never starts another rule", async () => {
    h.rules.create(ruleInput([tag(mark)]));
    const chained = h.rules.create(
      ruleInput([tag(flag)], { trigger: { kind: 'tagApplied', tagIds: [mark], sources: ['jev', 'manual'] } }),
    );
    const m = h.say('anything');
    await settleAsync();
    expect(h.tags.forMessage(m.id).map((c) => c.tagId)).toEqual([mark]);
    expect(runsOf(h, chained)).toEqual([]);
  });
});
