import { defineCorePlugin, type ArchiveRead, type Rollup, type RollupSpec } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_DAY, MS_PER_MIN, MS_PER_S } from '@plugin-sdk/shared';
import core, { plugin } from 'stats-bench-target';
import { CHANNEL, seed } from './fixture';
import { report } from './measure';
import { conversationStats } from '../../core/conversations';

const START = Date.UTC(2025, 0, 1);
const DAYS = 390; // Match the shared real-scale fixture.
const POLL_MS = MS_PER_S / 10;
const LIVE_MS = MS_PER_S / 4; // Four arrivals/second continue through enumeration and publication.
const TIMEOUT_MS = 10 * MS_PER_MIN;
const QUERY = { scope: 'channel', channelId: CHANNEL, sinceTs: null } as const;
const LIVE_CHANNEL = 'benchmark-live';
const LIVE_AUTHOR = { id: 'u0', username: 'author0', global_name: 'Author 0' }; // Preserve the seeded identity during ingestion.

export async function main(rows: number) {
  const definitions = new Map<string, { rollup: Rollup; spec: RollupSpec<any, any> }>();
  const profiled = defineCorePlugin(plugin, (ctx) => core.activate({ ...ctx, rollups: {
    define: (name, spec) => {
      const rollup = ctx.rollups.define(name, spec);
      definitions.set(name, { rollup, spec });
      return rollup;
    },
  } }));
  const host = testPlugin(profiled, { off: true, archive: { channels: [{ id: CHANNEL }, { id: LIVE_CHANNEL }] } });
  let live: ReturnType<typeof setInterval> | undefined;
  try {
    report('refresh', { seed: seed(host.db, rows) });
    await host.on();
    const client = host.client('renderer');
    if (process.env.STATS_REFRESH_PROFILE_ONLY) {
      await host.off();
      // Direct folds isolate each query from queue wait without changing the returned rows.
      for (const [name, { spec }] of definitions) {
        const timings: { ms: number; sql: string; plan: unknown[] }[] = [];
        const read: ArchiveRead = async (sql, params, options) => {
          const start = performance.now(), result = await host.read(sql, params, options);
          timings.push({ ms: performance.now() - start, sql, plan: host.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(Array.isArray(params) ? params : [params ?? {}])) });
          return result as never;
        };
        const startTs = START + (DAYS - 1) * MS_PER_DAY;
        const start = performance.now();
        await spec.compute({ channelId: CHANNEL, day: new Date(startTs).toISOString().slice(0, 10), startTs, endTs: startTs + MS_PER_DAY, timeZone: 'UTC' }, read, new AbortController().signal, spec.data);
        report('refreshProfile', { name, ms: performance.now() - start, queries: timings.sort((a, b) => b.ms - a.ms) });
      }
      return;
    }
    let inserted = 0;
    const insert = () => host.archive.arrive([{ channelId: CHANNEL, ts: START + DAYS * MS_PER_DAY + inserted++ * MS_PER_S,
      authorId: 'u0', extra: { author: LIVE_AUTHOR }, content: 'continuous live pizza' }]);
    if (!process.env.STATS_REFRESH_NO_LIVE) live = setInterval(insert, LIVE_MS);
    const started = performance.now();
    while ((await client.rollupStatus()).building) {
      const state = await client.rollupStatus();
      if (state.error) throw new Error(state.error);
      if (performance.now() - started > TIMEOUT_MS) throw new Error(`Build timed out: ${JSON.stringify(state)}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    report('refresh', { buildMs: performance.now() - started, liveInserts: inserted, state: await client.rollupStatus() });
    clearInterval(live); live = undefined;
    const current = await client.activityStats(QUERY);
    if (current.building || current.data?.messages !== rows + inserted) throw new Error('Live count is not exact');
    const checkIdentity = () => {
      const author = host.db.prepare('SELECT username, global_name FROM users WHERE id = ?').get(LIVE_AUTHOR.id) as { username: string; global_name: string };
      if (author.username !== LIVE_AUTHOR.username || author.global_name !== LIVE_AUTHOR.global_name) throw new Error('Benchmark changed the seeded author identity');
    };
    checkIdentity();
    const settle = async () => {
      const start = performance.now();
      while ((await client.rollupStatus()).maintaining) {
        const state = await client.rollupStatus();
        if (state.error) throw new Error(state.error);
        if (performance.now() - start > TIMEOUT_MS) throw new Error(`Drain timed out: ${JSON.stringify(state)}`);
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      return performance.now() - start;
    };
    report('refresh', { residualMs: await settle() });
    if (!process.env.STATS_REFRESH_INCREMENTAL_ONLY) {
      const retained = await client.activityStats(QUERY);
      await client.rebuildRollups();
      const pending = await client.activityStats(QUERY);
      if (!pending.building || JSON.stringify(pending.data) !== JSON.stringify(retained.data)) throw new Error('Rebuild lost retained data');
      report('refresh', { retained: true });
      await settle();
    }
    const start = performance.now();
    const revisions = () => host.db.prepare('SELECT rollup, revision FROM rollup_meta ORDER BY rollup').all() as { rollup: string; revision: number }[];
    const before = revisions();
    let incrementalInserts = 0;
    live = setInterval(() => host.archive.arrive([{ channelId: LIVE_CHANNEL, ts: START + DAYS * MS_PER_DAY + ++incrementalInserts * MS_PER_S,
      authorId: 'u0', extra: { author: LIVE_AUTHOR }, content: 'concurrent maintenance' }]), LIVE_MS);
    // Extend the fixture's uninterrupted 390-day run: this exercises its oldest opener.
    host.archive.arrive([{ channelId: CHANNEL, ts: START + DAYS * MS_PER_DAY - 1, authorId: 'u0', extra: { author: LIVE_AUTHOR }, content: 'old run extension' }]);
    checkIdentity();
    const pending = () => host.db.prepare(`SELECT COUNT(*) FROM (
      SELECT channel_id FROM rollup_dirty UNION ALL SELECT channel_id FROM rollup_changes
      UNION ALL SELECT channel_id FROM rollup_span_dirty UNION ALL SELECT channel_id FROM rollup_span_inputs
      UNION ALL SELECT channel_id FROM rollup_reference_changes) WHERE channel_id = ?`).pluck().get(CHANNEL) as number;
    while (pending()) {
      if (performance.now() - start > TIMEOUT_MS) throw new Error('Incremental drain timed out');
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    const elapsedMs = performance.now() - start;
    clearInterval(live); live = undefined;
    await settle();
    const publications = revisions().map((row, n) => ({ rollup: row.rollup, partitions: row.revision - before[n]!.revision }));
    report('refresh', { incrementalMs: elapsedMs, liveInserts: incrementalInserts, publications });
    const incremental = await client.conversationStats(QUERY), full = await conversationStats(host.read, QUERY);
    if (JSON.stringify(incremental.data) !== JSON.stringify(full)) throw new Error('Incremental conversations differ from full fold');
    report('refresh', { incrementalEqualsFull: true });
  } finally { clearInterval(live); await host.dispose(); }
}
