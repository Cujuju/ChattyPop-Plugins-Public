// Regression test: importing shared declarations before the registry preserves complete rule-kind lists.
import { describe, expect, it } from 'vitest';
import tags from '../shared';
import type { PluginDescriptor } from '@shared/bundledTypes';
import { ruleKinds, type RuleSection } from '@shared/ruleKinds';

const SECTIONS: RuleSection[] = ['triggers', 'match', 'filters', 'actions'];
/** Tags as the registry holds it: any descriptor, every section optional. */
const declared: PluginDescriptor = tags;

describe('rule kind declarations', () => {
  it('are all defined when a kind file is imported before the registry', () => {
    expect(tags.rules.triggers[0].type).toBe('tags.applied');
    expect(tags.rules.filters[0].type).toBe('tags.any');
    expect(tags.rules.actions[0].type).toBe('tags.apply');
    for (const section of SECTIONS) {
      for (const kind of declared.rules?.[section] ?? []) {
        expect(ruleKinds(section)).toContain(kind);
        expect(kind.create).toBeTypeOf('function');
      }
    }
    for (const section of SECTIONS) for (const k of ruleKinds(section)) expect(k?.type).toEqual(expect.any(String));
  });
});
