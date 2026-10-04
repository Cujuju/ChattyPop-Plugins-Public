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
import { ATTACHMENT_JOBS_TABLE, JOBS_TABLE } from '../core/schema';

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


  it('transcription: its jobs table, copied to part jobs; done transcripts become derived text in their order, searchable as before', async () => {
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
    // The adopted table stays for other app versions sharing the profile.
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('transcripts', 'fts_transcripts', ?, ?) ORDER BY name")
        .pluck()
        .all(ATTACHMENT_JOBS_TABLE, JOBS_TABLE),
    ).toEqual([ATTACHMENT_JOBS_TABLE, JOBS_TABLE].sort());
    expect(db.prepare(`SELECT attachment_id FROM ${ATTACHMENT_JOBS_TABLE} ORDER BY seq`).pluck().all()).toEqual(['a1', 'a2']);
    expect(db.prepare(`SELECT seq, message_id AS m, part_key AS part, kind, attachment_id AS a, state, text FROM ${JOBS_TABLE} ORDER BY seq`).all()).toEqual([
      { seq: 7, m: 'm1', part: 'attachment:a1', kind: 'audio', a: 'a1', state: 'done', text: 'hello lighthouse' },
      { seq: 8, m: 'm1', part: 'attachment:a2', kind: 'audio', a: 'a2', state: 'failed', text: null },
    ]);
    // Keyed by attachment id still, so transcribing it again replaces it.
    expect(db.prepare('SELECT source FROM derived_texts').pluck().all()).toEqual(['transcription:a1']);
    // A new job never takes a copied one's seq (its derived text key).
    db.prepare(`INSERT INTO ${JOBS_TABLE} (message_id, part_key, kind, state, priority, requested_at) VALUES ('m2', 'embed:x', 'video', 'queued', 0, 1)`).run();
    expect(db.prepare(`SELECT MAX(seq) FROM ${JOBS_TABLE}`).pluck().get()).toBe(9);
  });
});
