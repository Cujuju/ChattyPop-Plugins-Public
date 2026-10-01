// Tags' Jev switch: adopted from its pre-plugin key, stamped.
import { describe, expect, it } from 'vitest';
import { anchorCatalog, checkBundled } from '@shared/bundledCheck';
import { BUNDLED_PLUGINS } from '@shared/bundledPlugins';
import { aiSettingsFrom } from '@shared/aiProviders';
import { SETTINGS_KEYS } from '@shared/settings';
import { getSetting, setSetting } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { tempDb } from '@chattypop/host-testing';
import { plugin as tags } from '../shared';

/** Settings → AI as a profile from before Tags was a plugin stored it: its switch unstamped. */
const LEGACY_AI = {
  defaultProvider: null,
  providers: {},
  jevConnection: 'openrouter',
  jev: { messageTags: false, messageClasses: false, customTags: true },
};
const HOST_SWITCHES = ['messageTags', 'messageClasses'];
/** Tags' legacy switches: its declared keys, adopted unchanged. */
const legacyOwned = (tags.jev?.features ?? []).map((f) => ({ legacy: f.key, stamped: `${tags.manifest.id}.${f.key}` }));

describe('pre-plugin Jev switches', () => {
  it('read the same after adoption, and adoption runs once', () => {
    const db = tempDb();
    setSetting(db, SETTINGS_KEYS.ai, LEGACY_AI);
    adoptBundledData(db, [tags]);
    const once = getSetting(db, SETTINGS_KEYS.ai);
    adoptBundledData(db, [tags]);
    expect(getSetting(db, SETTINGS_KEYS.ai)).toEqual(once);
    const jev = aiSettingsFrom(once).jev as Record<string, boolean | undefined>;
    expect(legacyOwned.length).toBeGreaterThan(0);
    for (const { legacy, stamped } of legacyOwned) {
      expect(jev[stamped], stamped).toBe(LEGACY_AI.jev[legacy as keyof typeof LEGACY_AI.jev]);
      expect(Object.hasOwn(jev, legacy), legacy).toBe(false);
    }
    for (const f of HOST_SWITCHES) expect(jev[f], f).toBe(LEGACY_AI.jev[f as keyof typeof LEGACY_AI.jev]);
  });
});

describe('checkBundled over the installed descriptors', () => {
  it('accepts Tags', () => {
    expect(() => checkBundled([tags], anchorCatalog(BUNDLED_PLUGINS))).not.toThrow();
  });
});
