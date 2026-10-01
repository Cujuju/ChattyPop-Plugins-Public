// Alerts' shared declarations: rule kinds, adoption, Jev switches and queries, and channel audiences.
import { describe, expect, it } from 'vitest';
import { anchorCatalog, checkBundled } from '@shared/bundledCheck';
import { HOST_JEV_FEATURES, normalizeAiSettings } from '@shared/aiSettings';
import { HOST } from '@shared/ruleKinds/catalog';
import { kindUnavailable, switchState } from '@shared/ruleAvailability';
import { BUNDLED_PLUGINS, bundledJevFeatures, jevQueryPlugin } from '@shared/bundledPlugins';
import { parseRuleSpec, newRuleInput } from '@shared/ruleSpec';
import { audiencesOf } from '@shared/pluginChannels';
import { plugin } from '../shared';
import { notify } from '../shared/rules';
import { ALERT_QUERIES } from '../shared/queries';
import { DEFAULT_ALERT_COOLDOWN_MS } from '../shared/types';

describe('Alerts shared declarations', () => {
  it('owns all three kinds and preserves notification defaults and history', () => {
    expect(() => checkBundled([plugin], anchorCatalog(BUNDLED_PLUGINS))).not.toThrow();
    expect(plugin.rules.match.map((kind) => kind.type)).toEqual(['alerts.aimed', 'alerts.openQuestion']);
    expect(Object.values(HOST).flat().some((kind) => kind.type.startsWith('alerts.'))).toBe(false);
    expect(notify).toMatchObject({
      phase: 'match',
      history: true,
      targets: ['message'],
    });
    expect(notify.create()).toEqual({ toast: { cooldownMs: DEFAULT_ALERT_COOLDOWN_MS }, phone: { cooldownMs: DEFAULT_ALERT_COOLDOWN_MS } });
    expect(() => notify.validate({ toast: { cooldownMs: -1 } })).toThrow(/how often/);
    expect(() => notify.validate({ toast: null, phone: { cooldownMs: -1 } })).toThrow(/how often/);
    expect(kindUnavailable('alerts.aimed', () => switchState(false))).toMatch(/Alerts plugin.*off/);
  });

  it('declares adoption without replacing the original managed-rule identities', () => {
    expect(plugin.adopts.managedRules).toEqual({
      aimed_at_me: 'aimed_at_me',
      open_questions: 'open_questions',
    });
    const input = newRuleInput();
    input.spec.match = [{ type: 'alerts.aimed', config: null }];
    expect(parseRuleSpec(JSON.stringify(input.spec), 'alerts.aimed_at_me')).toEqual(input.spec);
    expect(() => parseRuleSpec(JSON.stringify(input.spec), 'alerts.open_questions')).toThrow(/could not be read/);
  });

  it('retains saved switches and query ids, with rerun subjects declared by the plugin', () => {
    for (const { key } of plugin.jev.features) {
      const stamped = `alerts.${key}` as const;
      expect(HOST_JEV_FEATURES).not.toContain(key);
      expect(bundledJevFeatures().find((f) => f.key === stamped)?.pluginId).toBe('alerts');
      expect(normalizeAiSettings({ jev: { [stamped]: true } }).jev[stamped]).toBe(true);
    }
    expect(ALERT_QUERIES.map((query) => query.id)).toEqual([
      'alerts.aimed',
      'alerts.openQuestion',
      'alerts.urgency',
      'alerts.sameEvent',
    ]);
    expect(ALERT_QUERIES.filter((query) => query.perMessage).map((query) => query.subject)).toEqual([
      'aimed',
      'question',
    ]);
    for (const query of ALERT_QUERIES) expect(jevQueryPlugin(query.id)).toBe('alerts');
    expect(jevQueryPlugin('rules.meaning')).toBeNull();
  });

  it('keeps inbox calls on desktop and phone and notification payloads in main', () => {
    for (const method of ['alerts', 'markRead', 'unread'])
      expect(audiencesOf(plugin.channels, 'core', method)).toEqual(['renderer', 'phone']);
    expect(audiencesOf(plugin.channels, 'events', 'changed')).toEqual(['renderer', 'phone']);
    expect(audiencesOf(plugin.channels, 'events', 'notify')).toEqual(['main']);
  });
});
