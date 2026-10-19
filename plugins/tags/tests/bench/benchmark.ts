import { performance } from 'node:perf_hooks';
import { testPlugin } from '@plugin-sdk/core/testing';
import { corePort } from '@plugin-sdk/shared/testing/ports';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import core from '../../core';
import { MESSAGE_TAGS } from '../../core/tables';
import { channelChipsSql, SHOWN_TAG_SQL, TagStore } from '../../core/store';
import { LIVE_CHIPS_MAX } from '../../core/reads';
import { CHANNEL, seed } from '../../../stats/tests/bench/fixture';
import { directory, directoryMatch } from '@core/queries/directory';
import { messagePage } from '@core/queries/messages';
import { unjudged, UNJUDGED_SQL, JUDGE_LOOKBACK_MS, JUDGE_RETRY_MS } from '@core/conversations/unjudged';
import { JUDGE_BELOW } from '@core/conversations/linker';
import { installRollupStore, markPartitions, replacePartition, rollupTable } from '@core/rollups/store';
import { openDb, type Db } from '@core/db';

/** Five samples match the existing stats benchmark's median convention. */
const SAMPLES = 5;
/** One third of messages carry tags, exercising the old archive-wide join and the new newest-first seek. */
const TAG_EVERY = 3;
/** A day contains about one thousand messages on the 400k/390-day fixture. */
const ROLLUP_ROWS = 1_000;
/** Replacing ten days measures per-call publication without timing compute or fixture setup. */
const PARTITIONS = 10;
/** The judge's production batch size and a regular displayed message page. */
const JUDGE_LIMIT = 20;
const PAGE_LIMIT = 50;
const BEFORE_CHIPS_SQL = `SELECT DISTINCT m.id FROM ${MESSAGE_TAGS} mt JOIN archive_all_messages m ON m.id = mt.message_id
  WHERE m.channel_id = ? AND mt.${SHOWN_TAG_SQL} ORDER BY m.ts DESC LIMIT ?`;

async function measure<T>(run: () => T | Promise<T>) {
  const samples = [];
  let result!: T;
  for (let n = 0; n < SAMPLES; n++) {
    const start = performance.now();
    const pending = run();
    const coreMs = performance.now() - start;
    result = await pending;
    samples.push({ wallMs: performance.now() - start, coreMs });
  }
  return { samples, result, medianWallMs: median(samples.map((s) => s.wallMs)), medianCoreMs: median(samples.map((s) => s.coreMs)) };
}
const median = (values: number[]): number => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const summary = <T>(value: Awaited<ReturnType<typeof measure<T>>>) => ({ medianWallMs: value.medianWallMs, medianCoreMs: value.medianCoreMs, samples: value.samples });
const same = (a: unknown, b: unknown): void => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Before/after result mismatch'); };

function rollupPublication(db: Db, publish: typeof replacePartition) {
  installRollupStore(db);
  const spec = { version: 1, columns: { term: 'TEXT', n: 'INTEGER' }, key: ['term'], dependsOn: ['messages'],
    allTime: { values: { n: 'sum' } }, compute: async () => [] } as const;
  const table = rollupTable(db, 'tags', 'bench', spec);
  const id = 'tags.bench';
  db.prepare('INSERT OR REPLACE INTO rollup_meta(rollup, version, zone) VALUES (?, 1, ?)').run(id, 'UTC');
  const rows = Array.from({ length: ROLLUP_ROWS }, (_, n) => ({ term: String(n), n }));
  const keys = rows.map(({ term }) => ({ term }));
  const times = [];
  for (let n = 0; n < PARTITIONS; n++) {
    const day = new Date(Date.UTC(2026, 0, n + 1)).toISOString().slice(0, 10);
    markPartitions(db, id, [{ channel_id: CHANNEL, day }]);
    const fold = { keys, rows: rows.map((row) => ({ ...row, n: row.n * (n + 1) })) };
    const start = performance.now();
    publish(db, id, table, { channel_id: CHANNEL, day, revision: 1 }, ['term', 'n'], rows, 0, fold);
    times.push(performance.now() - start);
  }
  db.exec(`DELETE FROM "${table}"; DELETE FROM "${table}_all_time"`);
  return { rowsPerPartition: ROLLUP_ROWS, medianMs: median(times), maxMs: Math.max(...times), samples: times };
}

export async function main(rows: number, baselineReplace: typeof replacePartition, rollupPath: string) {
  const t = testPlugin(core, { profile: { settings: { 'session.lastSeenAt': 1 } }, archive: { channels: [{ id: CHANNEL }] } });
  try {
    const fixture = seed(t.db, rows);
    const client = t.client('renderer');
    const tag = await client.createTag({ name: 'Benchmark', jevQuestion: null, auto: false });
    const insert = t.db.prepare(`INSERT INTO ${MESSAGE_TAGS}(message_id, tag_id, state, updated_at) VALUES (?, ?, 'manual', 0)`);
    t.db.transaction(() => { for (let n = 0; n < rows; n += TAG_EVERY) insert.run(String(n + 1), tag); })();
    const db = t.db as Db;
    const store = new TagStore(t.db);
    db.prepare(`DROP INDEX ${MESSAGE_TAGS}_message_state`).run();
    const beforeTagsPlan = db.prepare(`EXPLAIN QUERY PLAN ${BEFORE_CHIPS_SQL}`).all(CHANNEL, LIVE_CHIPS_MAX);
    const beforeTags = await measure(() => {
      const ids = db.prepare(BEFORE_CHIPS_SQL).all(CHANNEL, LIVE_CHIPS_MAX) as { id: string }[];
      return Object.fromEntries(store.chips(ids.map((r) => r.id)));
    });
    db.prepare(`CREATE INDEX ${MESSAGE_TAGS}_message_state ON ${MESSAGE_TAGS}(message_id, state, tag_id)`).run();
    const coldStart = performance.now();
    const coldTags = await client.liveTagChips(CHANNEL);
    const coldTagsMs = performance.now() - coldStart;
    const afterTags = await measure(() => client.liveTagChips(CHANNEL));
    same(beforeTags.result, coldTags); same(beforeTags.result, afterTags.result);
    const beforeDirectory = await measure(() => directory(db, 1));
    const afterDirectory = await measure(() => corePort(t.link).call('directory'));
    same(beforeDirectory.result, afterDirectory.result);
    db.prepare(`INSERT INTO conversation_links(message_id, channel_id, ts, parent_id, kind, confidence)
      SELECT id, channel_id, ts, NULL, 'inferred', ? FROM messages`).run(JUDGE_BELOW / 2);
    const now = (db.prepare('SELECT MAX(ts) AS ts FROM messages').get() as { ts: number }).ts + MS_PER_DAY;
    db.prepare('DROP INDEX conversation_links_kind_ts').run();
    const beforeJudge = await measure(() => unjudged(db, now, JUDGE_LIMIT));
    db.prepare('CREATE INDEX conversation_links_kind_ts ON conversation_links(kind, ts DESC)').run();
    const judgeParams = { below: JUDGE_BELOW, since: now - JUDGE_LOOKBACK_MS, retry: now - JUDGE_RETRY_MS, local: '[]', limit: JUDGE_LIMIT };
    const afterJudge = await measure(() => t.read(UNJUDGED_SQL, judgeParams, { priority: 'background' }));
    same(beforeJudge.result, afterJudge.result);
    const page = await measure(() => messagePage(db, { channelId: CHANNEL, limit: PAGE_LIMIT }));
    const rollupDb = openDb(rollupPath);
    let beforeRollup, afterRollup;
    try {
      beforeRollup = rollupPublication(rollupDb, baselineReplace);
      afterRollup = rollupPublication(rollupDb, replacePartition);
    } finally { rollupDb.close(); }
    return { fixture, tags: { before: summary(beforeTags), after: summary(afterTags), coldWallMs: coldTagsMs, beforePlan: beforeTagsPlan,
      plan: db.prepare(`EXPLAIN QUERY PLAN ${channelChipsSql()}`).all(CHANNEL, LIVE_CHIPS_MAX) },
      directory: { before: summary(beforeDirectory), after: summary(afterDirectory) },
      unjudged: { before: summary(beforeJudge), after: summary(afterJudge), plan: db.prepare(`EXPLAIN QUERY PLAN ${UNJUDGED_SQL}`).all(judgeParams) },
      messagePage: summary(page), rollupPublication: { before: beforeRollup, after: afterRollup } };
  } finally { await t.dispose(); }
}
