// Alerts' Jev switches and notice kind: adopted from pre-plugin keys, stamped, and privacy-scoped.
import { describe, expect, it } from 'vitest';
import { aiSettingsFrom } from '@shared/aiProviders';
import { adoptNoticeKinds, privacyScopedIn } from '@shared/notices';
import { SETTINGS_KEYS } from '@shared/settings';
import { getSetting, setSetting } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { tempDb } from '@chattypop/host-testing';
import { plugin as alerts } from '../shared';

/** Settings → AI as a profile from before Alerts was a plugin stored it: its switches unstamped. */
const LEGACY_AI = {
  defaultProvider: null,
  providers: {},
  jevConnection: 'openrouter',
  jev: { topicMeaning: true, ruleQuestions: false, urgentToasts: true, aimedAtMe: false, unansweredQuestions: true, dedupeAlerts: false },
};
const HOST_SWITCHES = ['topicMeaning', 'ruleQuestions'];
/** Alerts' legacy switches: its declared keys, adopted unchanged. */
const legacyOwned = (alerts.jev?.features ?? []).map((f) => ({ legacy: f.key, stamped: `${alerts.manifest.id}.${f.key}` }));

describe('pre-plugin Jev switches', () => {
  it('read the same after adoption, and adoption runs once', () => {
    const db = tempDb();
    setSetting(db, SETTINGS_KEYS.ai, LEGACY_AI);
    adoptBundledData(db, [alerts]);
    const once = getSetting(db, SETTINGS_KEYS.ai);
    adoptBundledData(db, [alerts]);
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

describe('phones’ notice choices', () => {
  it('adopt the pre-plugin alert kind and keep kinds of absent owners; drop what is not a kind', () => {
    const stored = ['alert', 'plugin', 'summary', 'gone.kind', 'alerts.alert', 'bad kind', 3];
    expect(adoptNoticeKinds([alerts], stored)).toEqual(['alerts.alert', 'plugin', 'summary', 'gone.kind']);
  });

  it('are privacy-scoped as their declaration says, stamped', () => {
    expect(privacyScopedIn([alerts], 'alerts.alert')).toBe(true);
    expect(privacyScopedIn([alerts], 'alert')).toBe(false);
    expect(privacyScopedIn([alerts], 'plugin')).toBe(false);
  });
});
