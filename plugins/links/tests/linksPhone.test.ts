// Links on the phone: the feed's reads and its refresh event reach it, its section sits beside Summaries, and it reads
// and moves the watermark.
import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import { anchorCatalog, checkBundled } from '@shared/bundledCheck';
import { BUNDLED_PLUGINS } from '@shared/bundledPlugins';
import { audiencesOf } from '@shared/pluginChannels';
import { MS_PER_MIN } from '@shared/units';
import linksCore from '../core';
import { UPDATED_EVENT, decodeMarkSeen, plugin } from '../shared';

describe('Links on the phone', () => {
  it('serves the feed to desktop and phone as reads', () => {
    expect(() => checkBundled([plugin], anchorCatalog(BUNDLED_PLUGINS))).not.toThrow();
    for (const method of ['page', 'counts'] as const) {
      expect(audiencesOf(plugin.channels, 'core', method)).toEqual(['renderer', 'phone']);
      expect(plugin.channels.audiences.core[method].writes).toBe(false);
    }
    expect(audiencesOf(plugin.channels, 'events', UPDATED_EVENT)).toEqual(['renderer', 'phone']);
    expect(audiencesOf(plugin.channels, 'core', 'markSeen')).toEqual(['renderer', 'phone']);
  });

  it('places its section after Summaries and lets the phone read the watermark', () => {
    expect(plugin.slots.phoneSections).toEqual([{ id: 'feed', after: 'summaries.summary' }]);
    expect(plugin.preferences.seenUpTo.phone).toBe(true);
  });

  it("stores the phone's mark: the watermark moves to core's clock and nothing shared before it is new", async () => {
    const sharedAt = Date.now() - MS_PER_MIN;
    const t = testPlugin(linksCore, {
      archive: { channels: [{ id: 'c1' }], messages: [{ channelId: 'c1', ts: sharedAt, content: 'read https://example.com/post' }] },
      preferences: { seenUpTo: sharedAt - MS_PER_MIN },
    });
    onTestFinished(() => t.dispose());
    const phone = t.client('phone');
    const newSince = async (): Promise<number> => Object.values(await phone.counts({ sinceTs: t.preferences.get('seenUpTo')! })).reduce((a, n) => a + n, 0);
    expect(await newSince()).toBe(1);
    await phone.markSeen();
    expect(t.preferences.get('seenUpTo')).toBeGreaterThan(sharedAt);
    expect(await newSince()).toBe(0);
    expect(decodeMarkSeen()).toEqual([]);
  });
});
