// Transcription's rule kinds: narrowing to messages with a transcript.
import type { RuleFilterKind } from '@plugin-sdk/shared';

/** Holds for a message with at least one audio or video part transcribed to speech; it has no options. */
export const transcribed: RuleFilterKind<null, 'transcription.transcribed'> = {
  type: 'transcription.transcribed',
  // Beside Content, which picks voice messages, audio and video.
  after: 'contains',
  label: 'A transcript',
  hint: '',
  create: () => null,
  validate() {},
  // Every configuration narrows: only transcribed messages pass.
  narrows: () => true,
};
