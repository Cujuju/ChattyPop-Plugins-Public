// Tag rule declarations, kept together for extraction into the Tags plugin.
import type { TagTriggerSource } from './types';
import { AFTER_MESSAGE, type RuleTriggerKind, type RuleFilterKind, type RuleActionKind } from '@plugin-sdk/shared';

/** Selected tags and who applied them: Jev or the owner by hand. */
export interface AppliedConfig {
  tagIds: number[];
  sources: TagTriggerSource[];
}

/** The message must currently carry at least one selected tag. */
export interface AnyTagConfig {
  tagIds: number[];
}

/** The tag to apply; null until the owner picks one. */
export interface ApplyTagConfig {
  tagId: number | null;
}

/** Starts on a newly applied tag; tags applied by rules never start rules. */
export const applied: RuleTriggerKind<AppliedConfig, 'tags.applied'> = {
  type: 'tags.applied',
  overview: 'a tag is put on one',
  after: 'message',
  label: 'A tag put on a message',
  hint: '',
  event: 'message',
  create: () => ({
    tagIds: [],
    sources: ['manual', 'jev'],
  }),
  validate(c) {
    if (!c.tagIds.length || !c.sources.length)
      throw new Error('Pick the tags, and whether Jev or you applying them starts the rule.');
  },
};

/** Narrows to messages carrying any selected tag now. */
export const anyTag: RuleFilterKind<AnyTagConfig, 'tags.any'> = {
  type: 'tags.any',
  after: 'linkDomains',
  label: 'Tag',
  hint: '',
  create: () => ({ tagIds: [] }),
  validate() {},
  narrows: (c) => c.tagIds.length > 0,
};

/** Applies a tag while respecting the owner’s manual removal. */
export const applyTag: RuleActionKind<ApplyTagConfig, 'tags.apply'> = {
  ...AFTER_MESSAGE,
  type: 'tags.apply',
  verb: 'tag',
  after: 'alerts.notify',
  label: 'Tag the message',
  hint: 'Puts one of your tags on it (a tag you removed by hand stays off).',
  create: () => ({ tagId: null }),
  validate(c) {
    if (c.tagId === null) throw new Error('Pick the tag to apply.');
  },
};
