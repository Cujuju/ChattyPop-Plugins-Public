import { describe, expect, it } from 'vitest';
import { plugin } from '../shared';
import { STATS_SECTIONS } from '../shared/types';

describe('Analytics section preference', () => {
  it('defaults to Overview and normalizes unknown stored values', () => {
    const preference = plugin.preferences.section;
    expect(preference.default).toBe('overview');
    for (const value of ['unknown', '', 'toString', null, undefined, 1, {}, []]) {
      expect(preference.normalize(value)).toBe('overview');
    }
  });

  it('preserves every known section id', () => {
    for (const id of Object.keys(STATS_SECTIONS)) expect(plugin.preferences.section.normalize(id)).toBe(id);
  });
});
