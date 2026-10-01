// Tag trigger and filter implementations, and tags applied by rules.
import type { RuleTagResult } from './store';
import type { CoreContext } from '@plugin-sdk/core';
import type { plugin } from '../shared';
import type { ActionResult } from '@plugin-sdk/core';

const RESULTS: Record<RuleTagResult, ActionResult> = {
  applied: {
    outcome: 'done',
    detail: null,
  },
  shown: {
    outcome: 'done',
    detail: 'The message already had the tag.',
  },
  removed: {
    outcome: 'skipped',
    detail: 'You took this tag off the message by hand, so it stays off.',
  },
  noTag: {
    outcome: 'failed',
    detail: 'The tag no longer exists.',
  },
};

/** Registers tag narrowing and application; per-message facts cache tag reads. */
export function registerTagKinds(k: CoreContext<typeof plugin>['rules'], ids: (messageId: string) => Set<number>, apply: (messageId: string, tagId: number) => RuleTagResult): void {
  k.filter(
    'tags.any',
    {
      test: (c, { facts }) => !c.tagIds.length || c.tagIds.some((id) => facts.memo('ids', () => ids(facts.m.id)).has(id)),
    },
  );
  k.action(
    'tags.apply',
    (c, r) => {
      if (r.event.kind !== 'message') throw new Error('Tagging needs a message.');
      return c.tagId === null ? {
        outcome: 'failed',
        detail: 'No tag picked.',
      } : RESULTS[apply(r.event.m.id, c.tagId)];
    },
  );
}
