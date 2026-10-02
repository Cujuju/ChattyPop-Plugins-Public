// Links on the phone: the feed's reads and its refresh event reach it, its section sits beside Summaries, and it reads the watermark.
import { describe, expect, it } from 'vitest';
import { anchorCatalog, checkBundled } from '@shared/bundledCheck';
import { BUNDLED_PLUGINS } from '@shared/bundledPlugins';
import { audiencesOf } from '@shared/pluginChannels';
import { UPDATED_EVENT, plugin } from '../shared';

describe('Links on the phone', () => {
  it('serves the feed to desktop and phone as reads', () => {
    expect(() => checkBundled([plugin], anchorCatalog(BUNDLED_PLUGINS))).not.toThrow();
    for (const method of ['page', 'counts'] as const) {
      expect(audiencesOf(plugin.channels, 'core', method)).toEqual(['renderer', 'phone']);
      expect(plugin.channels.audiences.core[method].writes).toBe(false);
    }
    expect(audiencesOf(plugin.channels, 'events', UPDATED_EVENT)).toEqual(['renderer', 'phone']);
  });

  it('places its section after Summaries and lets the phone read the watermark', () => {
    expect(plugin.slots.phoneSections).toEqual([{ id: 'feed', after: 'summaries.summary' }]);
    expect(plugin.preferences.seenUpTo.phone).toBe(true);
  });
});
