// An alert's author, and alerts listed and marked read by rule.
import { beforeEach, describe, expect, it } from 'vitest';
import { alertRule, ruleHarness, type Harness } from './ruleHarness';

let h: Harness;
beforeEach(() => {
  h = ruleHarness();
});

const say = (content: string, extra: Record<string, unknown> = {}) => h.say(content, { extra });

describe('an alert', () => {
  it('carries its author for their avatar', () => {
    const id = h.rules.create(alertRule({ text: { pattern: 'hello', spec: null } }));
    const withAvatar = say('hello', { author: { id: 'u3', username: 'u3', avatar: 'hash3' } });
    const without = say('hello');
    expect(h.rules.alerts({ limit: 50, ruleIds: [id] }).map((a) => [a.messageId, a.authorId, a.authorAvatar])).toEqual([
      [without.id, 'u2', null],
      [withAvatar.id, 'u3', 'hash3'],
    ]);
  });
});

describe('alerts narrowed to a set of rules', () => {
  it('lists and marks read only the chosen rules; an empty set means every rule', () => {
    const [a, b, c] = ['apple', 'banana', 'cherry'].map((word) =>
      h.rules.create(alertRule({ text: { pattern: word, spec: null } }, { name: word })),
    );
    ['apple', 'banana', 'cherry'].forEach((word) => say(word));
    const shown = (ruleIds: number[]) =>
      h.rules
        .alerts({ limit: 50, ruleIds })
        .map((x) => x.ruleId)
        .sort();
    expect(shown([a!, b!])).toEqual([a, b].sort());
    expect(shown([])).toEqual([a, b, c].sort());
    h.rules.markRead(null, [a!, c!]);
    expect(h.rules.alerts({ limit: 50, unreadOnly: true }).map((x) => x.ruleId)).toEqual([b]);
  });
});
