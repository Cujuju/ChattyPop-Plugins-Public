import { describe, expect, it } from 'vitest';
import { listedPerson, resetPerson } from '../renderer/personSelection';
import type { StatsPlace } from '../shared/types';

const C1: StatsPlace = { by: 'channel', id: 'c1' };
const SERVER: StatsPlace = { by: 'guild', id: 'g1' };

describe('Analytics session person choice', () => {
  it('resets when the place moves: to another channel, a server or everything', () => {
    for (const next of [{ by: 'channel', id: 'c2' } as const, SERVER, null]) expect(resetPerson('a', C1, next)).toBeNull();
    expect(resetPerson('a', null, C1)).toBeNull();
  });
  it('keeps the person when the place stays, and on first observation', () => {
    expect(resetPerson('a', C1, { ...C1 })).toBe('a');
    expect(resetPerson('a', null, null)).toBe('a');
    expect(resetPerson('a', undefined, C1)).toBe('a');
  });
  it('falls back to Everyone when a completed place/range list omits the chosen person', () => {
    expect(listedPerson('a', [{ userId: 'a' }, { userId: 'b' }])).toBe('a');
    expect(listedPerson('a', [{ userId: 'b' }])).toBeNull();
    expect(listedPerson('a', [])).toBeNull();
    expect(listedPerson(null, [{ userId: 'a' }])).toBeNull();
  });
});
