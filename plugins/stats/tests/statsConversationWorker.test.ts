import { expect, it, onTestFinished } from 'vitest';
import type { ArchiveRead } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import core from '../core';
import { conversationStats } from '../core/conversations';
import type { StatsRollups } from '../core/rollups';

const RUNS = 200_000; // Large histories expose projection work or full-history transfers accidentally returned to Core.
const RESULT_BYTES = 10_000; // A two-person graph and its role rankings fit comfortably within ten kilobytes.
const ALL = { scope: 'all', channelId: null, sinceTs: null } as const;
it('projects 200k runs in the worker and caches only normalized, bounded results', async () => {
  const t = testPlugin(core, { off: true }); onTestFinished(() => t.dispose());
  (globalThis as any).conversationCoreSentinel = true;
  onTestFinished(() => { delete (globalThis as any).conversationCoreSentinel; });
  const synthetic = async (_part: unknown, _read: unknown, _signal: unknown, data: any) => {
    const payload = JSON.stringify({ opener: 'a', closer: 'b', replyMs: 1, people: [
      { userId: 'a', name: 'A', count: 1 }, { userId: 'b', name: 'B', count: 1 }], pairs: [{ firstId: 'a', secondId: 'b', exchanges: 1 }] });
    return Array.from({ length: data.rows }, (_, n) => ({ opener_id: String(n), first_ts: n, last_ts: n + 1, payload }));
  };
  let folds = 0;
  const read: ArchiveRead = async (sql, params, options) => {
    if (!options?.fold) return t.read(sql, params, options);
    folds++;
    const data = options.fold.data as any;
    const result = await t.read(sql, params, { ...options, fold: { ...options.fold, data: { ...data, rows: RUNS,
      view: undefined, compute: synthetic.toString(),
      projector: `async function(rows, read, data) { if (globalThis.conversationCoreSentinel) throw new Error('Projection ran on Core'); return (${data.projector})(rows, read, data); }`,
    } } });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(RESULT_BYTES);
    return result as any;
  };
  const rollups = { runs: { snapshot: () => 'clean' } } as unknown as StatsRollups;
  const result = await conversationStats(read, ALL, rollups);
  expect(result.messages).toBe(RUNS * 2);
  expect(result.conversations).toBe(RUNS);
  const alias = { ...ALL, channelId: 'ignored-for-all', authorId: null };
  expect(await conversationStats(read, alias, rollups)).toEqual({ ...result, query: alias });
  expect(folds).toBe(1);
  expect((await conversationStats(read, { ...ALL, authorId: 'a' }, rollups)).messages).toBe(RUNS);
  expect(folds).toBe(2);
});
