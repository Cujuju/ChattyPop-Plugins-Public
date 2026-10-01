// Plans in the host's catalogs: its Jev query and feature where the built-in ones were, and the table it adopts.
import { beforeEach, describe, expect, it } from 'vitest';
import { bundledJevFeatures, jevQueryPlugin } from '@shared/bundledPlugins';
import { JEV_QUERIES, JEV_QUERY_GROUPS } from '@shared/jevQueries';
import { ProviderRegistry } from '@core/ai/registry';
import { setSetting, type Db } from '@core/db';
import { rerunSubjects } from '@core/jev/rerun';
import { adoptBundledData } from '@core/plugins/adoption';
import type { CorePlugin } from '@core/plugins/context';
import { PluginHost } from '@core/plugins/host';
import { RuleKinds } from '@core/rules/kinds';
import { tempDb, tempDir } from '@chattypop/host-testing';
import plansCore from '../core';
import { PLANS_TABLE } from '../core/schema';
import { PLAN_QUERY, PLAN_SUBJECT } from '../shared';

describe('Jev queries from plugins', () => {
  it('join the catalog in group order, where the built-in ones were', () => {
    const ids = JEV_QUERIES.map((q) => q.id);
    expect(ids.indexOf(PLAN_QUERY)).toBe(ids.indexOf('messages.tags') + 1);
    const groups = JEV_QUERIES.map((q) => JEV_QUERY_GROUPS.indexOf(q.group));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    expect(jevQueryPlugin(PLAN_QUERY)).toBe('plans');
    expect(bundledJevFeatures().find((f) => f.key === 'plans.planDetection')?.pluginId).toBe('plans');
    expect(jevQueryPlugin('messages.tags')).toBeNull();
  });

  it('re-run on past messages under their own subject', () => {
    expect(rerunSubjects(tempDb(), PLAN_QUERY)).toEqual(new Set([PLAN_SUBJECT]));
  });
});

describe('Plans adopts what it stored as a built-in', () => {
  let db: Db;
  const load = async (entry: CorePlugin): Promise<PluginHost> => {
    const host = new PluginHost(
      tempDir(),
      {
        db,
        emit: () => undefined,
        changed: () => undefined,
        ai: async () => ({ text: '' }),
        decider: () => null,
        bundled: {
          rules: new RuleKinds(),
          ready: () => db,
          archive: () => null as never,
          mediaDir: tempDir(),
          attachmentsDir: tempDir(),
          pluginData: { root: tempDir(), unmoved: {} },
          storeText: () => undefined,
          catchUp: () => undefined,
          storeLinkText: () => undefined, storeLinkImages: () => undefined,
          saveSetting: (key, value) => setSetting(db, key, value),
          aiSettings: () => null as never,
          providers: new ProviderRegistry(() => undefined),
          decider: () => null,
          now: Date.now,
        },
      },
      [entry],
    );
    adoptBundledData(db, [entry.plugin]); // as core init does, before plugins start
    await host.loadAll();
    expect(host.list()[0]).toMatchObject({ status: 'active', error: null });
    return host;
  };
  beforeEach(() => {
    db = tempDb();
  });

  it('the plans table, with what it holds', async () => {
    db.prepare(
      `INSERT INTO plans (message_id, channel_id, kind, title, when_ts, who_json, details, created_at) VALUES ('m1', 'c1', 'plan', 'Game night', NULL, '[]', '', 1)`,
    ).run();
    await load(plansCore);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('plans', ?)")
        .pluck()
        .all(PLANS_TABLE),
    ).toEqual([PLANS_TABLE]);
    expect(db.prepare(`SELECT title FROM ${PLANS_TABLE}`).pluck().all()).toEqual(['Game night']);
  });
});
