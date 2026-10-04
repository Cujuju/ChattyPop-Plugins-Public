// Translation's rule kinds: narrowing to messages with a translation.
import type { RuleFilterKind } from '@plugin-sdk/shared';

/** Holds for a message with at least one part translated (not one already in the owner's language); it has no options. */
export const translated: RuleFilterKind<null, 'translation.translated'> = {
  type: 'translation.translated',
  // Beside "A transcript" (Transcription); appended when Transcription isn't installed.
  after: 'transcription.transcribed',
  label: 'A translation',
  hint: '',
  create: () => null,
  validate() {},
  // Every configuration narrows: only translated messages pass.
  narrows: () => true,
};
