// #78: the owner's own message tags, applied by Jev (a tag's question) and/or by hand, shown as chips.
import { validateJevQuestion, type CustomJevQuestion } from '@plugin-sdk/shared';

/** Chip text stays short enough to sit beside a message. */
export const TAG_NAME_MAX = 32;
/** Upper bound on messages one range run asks about: bounds cost (~$0.000015 per message per tag) and time. */
export const TAG_RANGE_MAX = 2000;
/** jev_judgments subject for a tag's question; distinct from the built-in 'tag' (#66) subject. */
export const tagSubject = (id: number): string => `usertag:${id}`;

/** A tag definition and the count of visible messages carrying it. */
export interface Tag {
  id: number;
  name: string;
  /** Jev's question and when its answer applies the tag; null = a manual-only tag. */
  jevQuestion: CustomJevQuestion | null;
  /** Ask the question about every new message (needs Settings → Jev → custom tags on). */
  auto: boolean;
  createdAt: number;
  /** Messages carrying the tag now. */
  count: number;
}

/** Editable tag fields. */
export interface TagInput {
  name: string;
  jevQuestion: CustomJevQuestion | null;
  auto: boolean;
}

/** Throws with a message for the editor. */
export function validateTagInput(input: TagInput): void {
  const name = input.name.trim();
  if (!name) throw new Error('Name the tag.');
  if (name.length > TAG_NAME_MAX) throw new Error(`Keep the name to ${TAG_NAME_MAX} characters.`);
  if (input.jevQuestion) validateJevQuestion(input.jevQuestion);
  if (input.auto && !input.jevQuestion) throw new Error('Only a tag with a Jev question can tag new messages.');
}

/** Which messages a range run covers: a channel's (and its threads') latest N, or those sent between two times. */
export type TagRangeScope = {
  kind: 'latest';
  count: number;
} | {
  kind: 'between';
  fromTs: number;
  toTs: number;
};

/** Selected tags and channel range for an explicit Jev run. */
export interface TagRangeRequest {
  channelId: string;
  /** Tags whose questions to ask; manual-only tags are ignored. */
  tagIds: number[];
  scope: TagRangeScope;
}

/** Counts and known Jev cost from a completed range. */
export interface TagRangeResult {
  /** Messages asked about. */
  asked: number;
  /** Tags newly applied by Jev. */
  applied: number;
  failed: number;
  costUsd: number | null;
}

/** Who put a tag on a message: the owner by hand, Jev (its answer met the tag's condition), or one of the owner's rules. */
export type TagChipSource = 'manual' | 'jev' | 'rule';
/** A chip's tooltip per source. */
export const TAG_SOURCE_TITLE: Readonly<Record<TagChipSource, string>> = {
  manual: 'Your tag, added by you',
  jev: 'Your tag, applied by Jev (a model’s estimate)',
  rule: 'Your tag, applied by one of your rules',
};

/** A message carrying a tag, newest first in the Tags panel. `value`: Jev's answer, for a jev tag. */
export interface TaggedMessage {
  messageId: string;
  channelId: string;
  channelName: string;
  ts: number;
  author: string;
  content: string;
  source: TagChipSource;
  value: number | null;
}

/** A tag on one message, as the manual tag picker and live chips show it. */
export interface MessageTagChip {
  tagId: number;
  name: string;
  source: TagChipSource;
}

/** Who may start a tag-applied rule. */
export type TagTriggerSource = 'manual' | 'jev';

/** A person's most-used visible tags. */
export type PersonTags = {
  name: string;
  count: number;
}[];
