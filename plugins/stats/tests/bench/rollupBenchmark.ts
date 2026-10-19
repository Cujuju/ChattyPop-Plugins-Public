import { defineCorePlugin, type ArchiveRead } from '@plugin-sdk/core';
import { plugin } from '../../shared';
import { testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_MIN, MS_PER_S } from '@plugin-sdk/shared';
import { ROLLUP_READ_BUDGET_MS } from '@plugin-sdk/core';
import core from '../../core';
import { report } from './measure';
import { CHANNEL, seed } from './fixture';

const RUNS = 5; // Five warm samples retain the same median convention as the attachment benchmark.
const BUILD_TIMEOUT_MS = 20 * MS_PER_MIN; // Large lexical tables need a bounded, resumable offline build.
const POLL_MS = MS_PER_S / 10; // Status polls do not create archive-read work.
const QUERY = { scope: 'channel', channelId: CHANNEL, sinceTs: null } as const;
const SECTIONS = ['activityStats', 'peopleStats', 'postersPage', 'personStreaks', 'personHistory', 'voiceStats', 'repeatedLinks', 'emojiStats', 'wordStats', 'sentimentStats', 'conversationStats'] as const;

export async function main(rows: number) {
  const profiled = defineCorePlugin(plugin, (ctx) => core.activate({ ...ctx, storage: { ...ctx.storage,
    read: ((sql, params, options) => ctx.storage.read(sql, params, options?.fold?.source.includes('textReadWork')
      ? { ...options, fold: { ...options.fold, data: { ...options.fold.data as object, profile: true } } } : options)) as ArchiveRead,
  } }));
  const host = testPlugin(profiled, { off: true, archive: { channels: [{ id: CHANNEL }] } });
  const client = host.client('renderer');
  try {
    report('rollup', { seed: seed(host.db, rows) });
    const started = performance.now();
    await host.on();
    let state;
    while ((state = await client.rollupStatus()).building) {
      if (state.error) throw new Error(state.error);
      if (performance.now() - started > BUILD_TIMEOUT_MS) throw new Error('Rollup build timed out');
      await new Promise((done) => setTimeout(done, POLL_MS));
    }
    report('rollup', { buildMs: performance.now() - started });
    for (const name of ['counts', 'shares', 'shares_v1_all_time', 'text', 'runs']) {
      const table = `p_stats_rollup_${name.includes('_v1') ? name : name + '_v1'}`;
      report('rollup', { grain: name, rows: host.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(),
        bytes: host.db.prepare('SELECT SUM(pgsize) AS bytes FROM dbstat WHERE name = ?').get(table) });
    }
    for (const member of SECTIONS) {
      const run = () => (client[member] as (q: any) => unknown)({ ...QUERY, ...(member === 'postersPage' ? { offset: 0, limit: 200 } : {}) });
      const coldStart = performance.now();
      const warmed = await run() as { benchmarkSql?: unknown };
      report('cold', { read: member, ms: Number((performance.now() - coldStart).toFixed(2)) });
      if (warmed.benchmarkSql) report('profile', { read: member, statements: warmed.benchmarkSql });
      const samples = [];
      for (let n = 0; n < RUNS; n++) { const start = performance.now(); await run(); samples.push(performance.now() - start); }
      samples.sort((a, b) => a - b);
      const medianMs = Number(samples[Math.floor(RUNS / 2)]!.toFixed(2));
      report('rollup', { read: member, medianMs, withinBudget: medianMs <= ROLLUP_READ_BUDGET_MS });
    }
  } finally { await host.dispose(); }
}
