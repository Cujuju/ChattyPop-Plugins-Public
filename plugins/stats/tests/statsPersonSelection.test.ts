import { describe, expect, it } from 'vitest';
import { listedPerson, resetPerson } from '../renderer/personSelection';
import type { StatsScope } from '../shared/types';

describe('Analytics session person choice', () => {
  it.each(['channel', 'server', 'all'] as StatsScope[])('resets on every scope switch from %s', (scope) => {
    for (const next of ['channel', 'server', 'all'] as StatsScope[]) {
      expect(resetPerson('a', { scope, channelId: 'c1' }, { scope: next, channelId: 'c1' })).toBe(next === scope ? 'a' : null);
    }
  });
  it.each(['channel', 'server'] as StatsScope[])('resets when the shown channel changes in %s scope', (scope) => {
    for (const channelId of ['c2', null]) expect(resetPerson('a', { scope, channelId: 'c1' }, { scope, channelId })).toBeNull();
  });
  it('keeps the person when Everything changes the shown channel, and on first observation', () => {
    expect(resetPerson('a', { scope: 'all', channelId: 'c1' }, { scope: 'all', channelId: 'c2' })).toBe('a');
    expect(resetPerson('a', undefined, { scope: 'channel', channelId: 'c1' })).toBe('a');
  });
  it('falls back to Everyone when a completed scope/range list omits the chosen person', () => {
    expect(listedPerson('a', [{ userId: 'a' }, { userId: 'b' }])).toBe('a');
    expect(listedPerson('a', [{ userId: 'b' }])).toBeNull();
    expect(listedPerson('a', [])).toBeNull();
    expect(listedPerson(null, [{ userId: 'a' }])).toBeNull();
  });
});
