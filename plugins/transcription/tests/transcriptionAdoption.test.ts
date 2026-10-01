// Transcription adopting what it stored as a built-in: its jobs table, and done transcripts as derived text.
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProviderRegistry } from '@core/ai/registry';
import { setSetting, type Db } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import type { CorePlugin } from '@core/plugins/context';
import { PluginHost } from '@core/plugins/host';
import { RuleKinds } from '@core/rules/kinds';
import { Database, applyMigrations, migrationIndex, tempDb, tempDir } from '@chattypop/host-testing';
import transcriptionCore from '../core';
import { JOBS_TABLE } from '../core/schema';

describe('transcription adopts what it stored as a built-in', () => {
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


  it('transcription: its jobs table; done transcripts become derived text in their order, searchable as before', async () => {
    db = new Database(join(tempDir(), 'old.db')) as unknown as Db;
    const cut = migrationIndex('CREATE TABLE derived_texts');
    applyMigrations(db, 0, cut);
    const job = db.prepare(
      `INSERT INTO transcripts (seq, attachment_id, message_id, state, text, priority, requested_at) VALUES (?, ?, 'm1', ?, ?, 0, 1)`,
    );
    job.run(7, 'a1', 'done', 'hello lighthouse');
    job.run(8, 'a2', 'failed', null);
    applyMigrations(db, cut);
    expect(db.prepare('SELECT seq, message_id AS m, source, ord, text FROM derived_texts').all()).toEqual([
      { seq: 7, m: 'm1', source: 'transcription:a1', ord: 7, text: 'hello lighthouse' },
    ]);
    expect(
      db.prepare(`SELECT rowid FROM fts_derived_texts WHERE fts_derived_texts MATCH 'lighthouse'`).pluck().all(),
    ).toEqual([7]);
    await load(transcriptionCore);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('transcripts', 'fts_transcripts', ?)",
        )
        .pluck()
        .all(JOBS_TABLE),
    ).toEqual([JOBS_TABLE]);
    expect(db.prepare(`SELECT attachment_id FROM ${JOBS_TABLE} ORDER BY seq`).pluck().all()).toEqual(['a1', 'a2']);
  });
});
