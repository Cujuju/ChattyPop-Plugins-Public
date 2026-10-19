import { defineCorePlugin } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import { plugin } from '../../shared';
import { CONVERSATION_GAP_MS, CONVERSATION_PAIRS, REPLY_MIN_RUNS } from '../../shared/conversations';
import { STATS_TOP } from '../../shared/types';
import { conversationProjection } from '../../core/conversationProjection';
import { createConversationRoles } from '../../core/conversationRoles';
import { conversationStats } from '../../core/conversations';
import { median } from '../../core/median';
import type { StatsRollups } from '../../core/rollups';
import { report } from './measure';

const SAMPLES = 5; // Five measurements retain the existing benchmark median convention.
const INSERTS = 100; // A hundred newest-message writes amortize timer noise without making the baseline sweep excessive.
const TABLE = 'p_stats_rollup_runs_v1';
const QUERY = { scope: 'all', channelId: null, sinceTs: null } as const;
const round = (n: number) => Number(n.toFixed(3));

export async function main(rows: number) {
  const probe = defineCorePlugin(plugin, (ctx) => { ctx.rollups.define('runs', {
    version: 1, columns: { opener_id: 'TEXT', first_ts: 'INTEGER', last_ts: 'INTEGER', payload: 'TEXT' }, key: ['opener_id'],
    span: { start: 'first_ts', end: 'last_ts', paddingMs: CONVERSATION_GAP_MS }, dependsOn: ['messages'], compute: async () => [],
  }); });
  const host = testPlugin(probe, { off: true, archive: { channels: [{ id: 'c' }] } });
  try {
    await host.on(); await host.off();
    for (const sql of ['UPDATE rollup_reference_state SET ready = 1', 'DELETE FROM rollup_reference_catalog', 'UPDATE rollup_meta SET backfill = 0', 'DELETE FROM rollup_dirty']) host.db.prepare(sql).run();
    const payload = JSON.stringify({ opener: 'a', closer: 'b', replyMs: 1,
      people: [{ userId: 'a', name: 'A', count: 1 }, { userId: 'b', name: 'B', count: 1 }], pairs: [{ firstId: 'a', secondId: 'b', exchanges: 1 }] });
    const insert = host.db.prepare(`INSERT INTO ${TABLE} VALUES ('c', '2026-01-01', ?, ?, ?, ?)`);
    host.db.transaction(() => { for (let n = 0; n < rows; n++) insert.run(String(n), n * CONVERSATION_GAP_MS, n * CONVERSATION_GAP_MS + 1, payload); })();
    const write = host.db.prepare("INSERT INTO messages(id, channel_id, author_id, ts, content) VALUES (?, 'c', 'a', ?, '')");
    for (const [name, columns] of [['before', 'first_ts, last_ts'], ['after', 'last_ts, first_ts']]) {
      host.db.prepare(`DROP INDEX ${TABLE}_span`).run();
      host.db.prepare(`CREATE INDEX ${TABLE}_span ON ${TABLE}(channel_id, ${columns})`).run();
      const samples = [];
      for (let sample = 0; sample < SAMPLES; sample++) {
        const started = performance.now();
        host.db.transaction(() => { for (let n = 0; n < INSERTS; n++) write.run(`${name}-${sample}-${n}`, (rows - 1) * CONVERSATION_GAP_MS + 1); })();
        samples.push((performance.now() - started) / INSERTS);
      }
      const plan = host.db.prepare(`EXPLAIN QUERY PLAN SELECT first_ts, last_ts FROM ${TABLE} INDEXED BY ${TABLE}_span WHERE channel_id = 'c' AND first_ts <= ? AND last_ts >= ?`)
        .all(rows * CONVERSATION_GAP_MS, (rows - 2) * CONVERSATION_GAP_MS);
      report('review', { finding: 'P4-1', variant: name, storedRuns: rows, insertsPerSample: INSERTS,
        medianMsPerInsert: round(samples.sort((a, b) => a - b)[Math.floor(SAMPLES / 2)]!), plan });
    }
    host.db.prepare('DELETE FROM rollup_dirty').run(); host.db.prepare('DELETE FROM rollup_span_dirty').run();
    const config = { query: QUERY, pairLimit: CONVERSATION_PAIRS, roles: createConversationRoles.toString(),
      roleConfig: { top: STATS_TOP, minRuns: REPLY_MIN_RUNS, median: median.toString() } };
    const history = await host.read<any>(`SELECT * FROM ${TABLE}`);
    const timed = async (run: () => Promise<unknown>) => {
      const started = performance.now();
      let firstTurnMs = 0;
      const turn = new Promise<void>((done) => setImmediate(() => { firstTurnMs = performance.now() - started; done(); }));
      const result = await run(); await turn;
      return { wallMs: round(performance.now() - started), firstTurnMs: round(firstTurnMs), bytesReturned: Buffer.byteLength(JSON.stringify(result)) };
    };
    report('review', { finding: 'Q4', variant: 'before-core-projection', storedRuns: rows,
      ...await timed(() => conversationProjection(history, host.read, config)) });
    const rollups = { runs: { snapshot: () => 'benchmark' } } as unknown as StatsRollups;
    report('review', { finding: 'Q4', variant: 'after-worker-cold', storedRuns: rows,
      ...await timed(() => conversationStats(host.read, QUERY, rollups)) });
    const samples = [];
    for (let n = 0; n < SAMPLES; n++) samples.push(await timed(() => conversationStats(host.read, QUERY, rollups)));
    samples.sort((a, b) => a.wallMs - b.wallMs);
    report('review', { finding: 'Q4', variant: 'after-worker-cached', storedRuns: rows, ...samples[Math.floor(SAMPLES / 2)] });
  } finally { await host.dispose(); }
}
