import { expect, it, onTestFinished, vi } from 'vitest';
import type { ArchiveRead } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import core from '../core';
import { wordStats } from '../core/words';
import { projectCounts } from '../core/countRead';
import { cachedStats, MAX_CACHE_BYTES } from '../core/readCache';
import type { StatsRollups } from '../core/rollups';

const ROWS = 200_000; // Exceeds the native argument limit for archive-sized summary and boundary arrays.
const ALL = { scope: 'all', channelId: null, sinceTs: null } as const;

it('folds 200k lexical fragments through wordStats in the production worker', async () => {
  const t = testPlugin(core, { off: true }); onTestFinished(() => t.dispose());
  const synthetic = async (_part: unknown, _read: unknown, _signal: unknown, data: any) => Array.from({ length: data.rows }, (_, n) => ({
    author_id: 'a', date: '2026-01-01', kind: 'lengths', n: 1, first_ts: n % 2, last_ts: n % 2, payload: '[[1,1,0,0]]',
  }));
  const read: ArchiveRead = (sql, params, options) => t.read(sql, params, options?.fold ? { ...options, fold: { ...options.fold,
    data: { ...options.fold.data as any, compute: synthetic.toString(), config: { rows: ROWS } },
  } } : options);
  expect((await wordStats(read, ALL)).totalWords).toBe(ROWS);
});

it('folds 200k summary rows and 200k boundary headers in the production count worker', async () => {
  const t = testPlugin(core, { off: true, archive: { channels: [{ id: 'c' }] } }); onTestFinished(() => t.dispose());
  const summaries = `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i + 1 FROM n WHERE i < ${ROWS}) SELECT i AS n FROM n`;
  t.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    INSERT INTO messages(id, channel_id, author_id, ts, content) SELECT 'bulk-' || i, 'c', 'a', 0, '' FROM n`).run(ROWS);
  const snapshots = { counts: { snapshot: () => 'clean' }, links: { snapshot: () => 'clean' } } as unknown as StatsRollups;
  const read: ArchiveRead = (sql, params, options) => {
    if (!options?.fold) return t.read(sql, params, options);
    const data = options.fold.data as any;
    const fold = { ...options.fold, data: { ...data, rowsSql: summaries, rowsParams: [], channelsSql: "SELECT 'c' AS channel_id",
      sql: '1', params: [], view: 'fixture', cuts: [0],
      projector: ((rows: any[]) => [{ rows: rows.length, boundary: rows.at(-1).n }]).toString() } };
    return t.read(sql, params, { ...options, fold });
  };
  // Summary rows exercise the same unbounded transfer without constructing message payloads on Core.
  const result = await projectCounts<{ rows: number; boundary: number }>(read, ALL, 'peopleStats', snapshots);
  expect(result).toEqual({ rows: ROWS + 1, boundary: ROWS });
});

it('does not retain a result larger than the cache byte budget', async () => {
  const read = vi.fn() as unknown as ArchiveRead;
  const load = vi.fn(async () => 'x'.repeat(MAX_CACHE_BYTES));
  await cachedStats(read, 'oversized', () => true, load);
  await cachedStats(read, 'oversized', () => true, load);
  expect(load).toHaveBeenCalledTimes(2);
});

it('restarts a changed count snapshot with the current time zone', async () => {
  let zone = 'UTC', snapshot = 'first';
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone };
  });
  onTestFinished(() => spy.mockRestore());
  const zones: string[] = [];
  const read: ArchiveRead = async (_sql, _params, options) => {
    const data = options!.fold!.data as any; zones.push(data.timeZone);
    if (zones.length === 1) { zone = 'America/Los_Angeles'; snapshot = 'second'; }
    return [{ zone: data.timeZone }] as any;
  };
  const rollups = { counts: { snapshot: () => snapshot }, links: { snapshot: () => snapshot } } as unknown as StatsRollups;
  expect(await projectCounts(read, ALL, 'peopleStats', rollups)).toEqual({ zone: 'America/Los_Angeles' });
  expect(zones).toEqual(['UTC', 'America/Los_Angeles']);
});
