// Summaries adopting what it stored as a built-in, and its citation shortcuts.
import { describe, expect, it } from 'vitest';
import { HOST_SHORTCUTS, placeByAnchor } from '@shared/anchors';
import { pluginSettingKey } from '@shared/bundledTypes';
import { anchorCatalog, checkBundled } from '@shared/bundledCheck';
import { BUNDLED_PLUGINS } from '@shared/bundledPlugins';
import { getSetting, setSetting } from '@core/db';
import { parkSummarySettings } from '@core/laterMigrations';
import { adoptBundledData } from '@core/plugins/adoption';
import { plugin } from '../shared';
import { SUMMARIES_TABLE } from '../core/schema';
import { adoptSummaries } from './summariesHarness';
import { tempDb } from '@chattypop/host-testing';

describe('Summaries plugin adoption', () => {
  it('keeps historical rows, seen progress and summary preferences while moving only owned AI fields', () => {
    const db = tempDb();
    db.prepare(`INSERT INTO summaries (cache_key, created_at, provider, since_ts, until_ts, channel_ids, message_count, duration_ms, headline, items_json)
      VALUES ('cache', 7, 'claude', 1, 6, '[]', 2, 3, 'Saved recap', '[]')`).run();
    const jevRouting = { cheapModel: 'cheap', premiumModel: 'premium', cheapEffort: null, premiumEffort: 'high' };
    setSetting(db, 'summary', { length: 'brief', focus: 'releases' });
    setSetting(db, 'summary.seenId', 17);
    setSetting(db, 'ai', { defaultProvider: 'claude', skipObviousFiller: false, jevRouting });
    adoptSummaries(db);
    expect(db.prepare(`SELECT cache_key, headline FROM ${SUMMARIES_TABLE}`).get()).toEqual({ cache_key: 'cache', headline: 'Saved recap' });
    expect(getSetting(db, pluginSettingKey('summaries', 'seenId'))).toBe(17);
    expect(getSetting(db, pluginSettingKey('summaries', 'settings'))).toEqual({ length: 'brief', focus: 'releases', skipObviousFiller: false, jevRouting });
    expect(getSetting(db, 'ai')).toEqual({ defaultProvider: 'claude' });
    adoptSummaries(db);
    expect(db.prepare(`SELECT COUNT(*) FROM ${SUMMARIES_TABLE}`).pluck().get()).toBe(1);
    expect(getSetting(db, pluginSettingKey('summaries', 'seenId'))).toBe(17);
  });

  it('preserves an existing plugin preference over a legacy AI preference', () => {
    const db = tempDb();
    setSetting(db, pluginSettingKey('summaries', 'settings'), { skipObviousFiller: true, focus: 'saved' });
    setSetting(db, 'ai', { skipObviousFiller: false, defaultProvider: 'codex' });
    adoptSummaries(db);
    expect(getSetting(db, pluginSettingKey('summaries', 'settings'))).toEqual({ skipObviousFiller: true, focus: 'saved' });
    expect(getSetting(db, 'ai')).toEqual({ defaultProvider: 'codex' });
  });

  it('parks summary preferences across an absent-plugin settings save and adopts them once', () => {
    const db = tempDb();
    const prefs = { skipObviousFiller: true, jevRouting: { chosen: 'preserve exactly' } };
    setSetting(db, 'ai', { ...prefs, defaultProvider: 'codex' });
    parkSummarySettings(db);
    setSetting(db, 'ai', { defaultProvider: 'ollama' });
    parkSummarySettings(db);
    expect(getSetting(db, 'legacy.summarySettings')).toEqual(prefs);
    adoptBundledData(db, [plugin]);
    expect(getSetting(db, 'plugin.summaries.settings')).toMatchObject(prefs);
    adoptBundledData(db, [plugin]);
    expect(getSetting(db, 'plugin.summaries.settings')).toMatchObject(prefs);
  });
});

it('owns citation shortcuts and preserves their placement with another plugin shortcut', () => {
  expect(() => checkBundled([plugin], anchorCatalog(BUNDLED_PLUGINS))).not.toThrow();
  const shortcuts = [...plugin.shortcuts, { key: 'x', after: 'k' }];
  const anchors = new Map(shortcuts.map((shortcut) => [shortcut.key, shortcut.after]));
  const host = Object.keys(HOST_SHORTCUTS);
  expect(placeByAnchor(host, shortcuts.map((shortcut) => shortcut.key), (key) => key, (key) => anchors.get(key)))
    .toEqual(['layout', 'j', 'k', 'x', ...host.slice(1)]);
  expect(placeByAnchor(host, ['x'], (key) => key, (key) => anchors.get(key)))
    .toEqual(['layout', 'x', ...host.slice(1)]);
});
