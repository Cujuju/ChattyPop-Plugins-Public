import { testPlugin } from '@plugin-sdk/core/testing';
import { knownReferenceSql } from '@core/rollups/privacy';
import core from '../../core';
import { CHANNEL, seed } from './fixture';

const CATALOG_CHANNELS = 1_000; // A large server catalog exposes per-message catalog scans.
const RUNS = 3; // Three independent fixtures report the median insert path.
const DECIMALS = 2; // Millisecond results retain useful timing precision.

export async function main(rows: number) {
  const results: Record<string, number[]> = { before: [], after: [] };
  for (const mode of ['before', 'after'] as const) for (let run = 0; run < RUNS; run++) {
    const t = testPlugin(core, { off: true, archive: { channels: [{ id: CHANNEL }] } });
    try {
      t.db.transaction(() => {
        for (let n = 0; n < CATALOG_CHANNELS; n++) t.db.prepare('INSERT INTO channels(id, name, kind) VALUES (?, ?, 0)').run(`catalog-${n}`, `Channel ${n}`);
      })();
      if (mode === 'before') for (const [table, target, column] of [
        ['messages', 'rollup_reference_messages', 'content'], ['links', 'rollup_reference_links', 'url'],
      ]) {
        t.db.prepare(`DROP TRIGGER ${target}_insert`).run();
        t.db.prepare(`CREATE TRIGGER ${target}_insert AFTER INSERT ON ${table} WHEN ${knownReferenceSql(`new.${column}`)}
          BEGIN INSERT OR IGNORE INTO ${target} VALUES (new.id); END`).run();
      }
      const started = performance.now();
      const fixture = seed(t.db, rows);
      const ms = performance.now() - started;
      results[mode]!.push(ms);
      console.log(JSON.stringify({ mode, run, ms: Number(ms.toFixed(DECIMALS)), ...fixture, catalogChannels: CATALOG_CHANNELS + 1 }));
    } finally { await t.dispose(); }
  }
  const median = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
  const before = median(results.before!), after = median(results.after!);
  console.log(JSON.stringify({ beforeMedianMs: Number(before.toFixed(DECIMALS)), afterMedianMs: Number(after.toFixed(DECIMALS)), speedup: Number((before / after).toFixed(DECIMALS)) }));
}
