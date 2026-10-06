// Codex's AI cost note uses the supplied call wording. Host tests cover aiRunWording's owner plural and requests fallback.
import { describe, expect, it } from 'vitest';
import { overheadNote } from '../renderer/overhead';

/** The AI-run owner's plural, and the host's word when no plugin owns AI runs. */
const OWNER_PLURAL = 'summaries';
const HOST_FALLBACK = 'requests';

describe('Codex overhead note', () => {
  it('names the AI calls with the given word', () => {
    expect(overheadNote(OWNER_PLURAL)).toBe(
      '. Each call also carries about 12k tokens of Codex’s own instructions, so short summaries cost more here than with Claude',
    );
    expect(overheadNote(HOST_FALLBACK)).toBe(
      '. Each call also carries about 12k tokens of Codex’s own instructions, so short requests cost more here than with Claude',
    );
  });
});
