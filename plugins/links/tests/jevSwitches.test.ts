// Links' Jev switches from before it was a plugin (docs/plugin-architecture.md §3, §7): stamped `links.<local>` once
// adopted, and the owner's value kept.
import { describe, expect, it } from 'vitest';
import { aiSettingsFrom } from '@shared/aiProviders';
import { SETTINGS_KEYS } from '@shared/settings';
import { getSetting, setSetting } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { tempDb } from '@chattypop/host-testing';
import { plugin as links } from '../shared';

const OWNERS = [links];


/** Settings → AI as a profile from before these features were plugins stored it: every switch unstamped. */
const LEGACY_AI = {
  defaultProvider: null,
  providers: {},
  jevConnection: 'openrouter',
  jev: {
    topicMeaning: true, catchUpBadges: false, ruleQuestions: false, keepImportant: true, searchRerank: true, messageTags: false,
    messageClasses: false, messageCheck: true, suggestChannels: false, pluginDecide: false,
    urgentToasts: true, aimedAtMe: false, unansweredQuestions: true, dedupeAlerts: false,
    summaryFilter: true, citationCheck: false, skipQuietStretches: true, conversationChunks: false, keyThemes: true, modelRouting: false,
    linkCategories: true, linkSafety: false, linkWorth: true, planDetection: true, customTags: true,
  },
};
const HOST_SWITCHES = ['topicMeaning', 'catchUpBadges', 'ruleQuestions', 'keepImportant', 'messageTags', 'messageClasses', 'messageCheck', 'suggestChannels', 'pluginDecide'];
/** Each plugin's legacy switches: its declared keys, adopted unchanged. */
const legacyOwned = OWNERS.flatMap((p) => (p.jev?.features ?? []).map((f) => ({ legacy: f.key, stamped: `${p.manifest.id}.${f.key}` })));

describe('pre-plugin Jev switches', () => {
  it('read the same after adoption, and adoption runs once', () => {
    const db = tempDb();
    setSetting(db, SETTINGS_KEYS.ai, LEGACY_AI);
    adoptBundledData(db, OWNERS);
    const once = getSetting(db, SETTINGS_KEYS.ai);
    adoptBundledData(db, OWNERS);
    expect(getSetting(db, SETTINGS_KEYS.ai)).toEqual(once);
    const jev = aiSettingsFrom(once).jev as Record<string, boolean | undefined>;
    expect(legacyOwned.length).toBeGreaterThan(0);
    for (const { legacy, stamped } of legacyOwned) {
      expect(jev[stamped], stamped).toBe(LEGACY_AI.jev[legacy as keyof typeof LEGACY_AI.jev]);
      expect(Object.hasOwn(jev, legacy), legacy).toBe(false);
    }
    for (const f of HOST_SWITCHES) expect(jev[f], f).toBe(LEGACY_AI.jev[f as keyof typeof LEGACY_AI.jev]);
  });

  it('keep the owner’s value over a default a save stored under the stamped key before adoption', () => {
    const db = tempDb();
    setSetting(db, SETTINGS_KEYS.ai, { ...LEGACY_AI, jev: { ...LEGACY_AI.jev, 'links.linkWorth': false } });
    adoptBundledData(db, [links]);
    expect(aiSettingsFrom(getSetting(db, SETTINGS_KEYS.ai)).jev['links.linkWorth']).toBe(true);
  });
});

