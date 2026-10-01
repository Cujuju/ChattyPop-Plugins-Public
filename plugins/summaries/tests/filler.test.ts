// Contract tests for filler.
import { describe, expect, it } from 'vitest';
import { FILLER_MAX_CHARS, isFiller } from '../core/filler';

describe('summary filler rules', () => {
  it('drops messages that are only links or emoji', () => {
    expect(isFiller('https://x.com/a/status/1', false)).toBe(true);
    expect(isFiller('<https://example.com> <:pog:123456> 😂👍🏽', false)).toBe(true);
  });

  it('drops short throwaways, but keeps ones that carry a fact or a question', () => {
    expect(isFiller('lol', false)).toBe(true);
    expect(isFiller('yeah true', false)).toBe(true);
    expect(isFiller('6pm?', false)).toBe(false);
    expect(isFiller('$40', false)).toBe(false);
  });

  it('keeps a short reply (it may be the answer) and anything longer than the cutoff', () => {
    expect(isFiller('no', true)).toBe(false);
    expect(isFiller('x'.repeat(FILLER_MAX_CHARS + 1), false)).toBe(false);
  });
});
