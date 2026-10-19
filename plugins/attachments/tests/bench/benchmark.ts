import { testPlugin } from '@plugin-sdk/core/testing';
import { attachmentTotals, attachmentPeople, attachmentPlaces } from '../../core/totals';
import { attachmentMonths } from '../../core/months';
import { attachmentBreakdown } from '../../core/space';
// Benchmark-only cross-plugin import; production plugins remain independent.
import { linkCounts } from '../../../links/core/feed';
import { CHANNEL, seed } from './fixture';
import attachmentsCore from '../../core';
import linksCore from '../../../links/core';
import { ROLLUP_READ_BUDGET_MS } from '@plugin-sdk/core';
import { MS_PER_MIN, MS_PER_S, type RollupStatus } from '@plugin-sdk/shared';

const RUNS = 5; // Median of five warm reads limits single-run scheduler noise.
const PEOPLE_LIMIT = 50; // Matches the panel's bounded picker.
const BYTE_UNIT = 1024; // SQLite page sizes are converted to KiB.
const PAGE_BYTES = 4096; // The fixture uses SQLite's default page size.
const BUILD_POLL_MS = MS_PER_S / 10; // Status polling observes progress without creating read work.
const BUILD_TIMEOUT_MS = 10 * MS_PER_MIN; // A bounded synthetic build must finish before benchmark results are accepted.
const HISTORY = { sinceTs: Date.UTC(2024, 11, 31), untilTs: Date.UTC(2026, 1, 1) }; // Explicit bounds cover the complete synthetic history.

async function built(status: () => Promise<RollupStatus>) {
  const deadline = performance.now() + BUILD_TIMEOUT_MS;
  while (true) {
    const state = await status();
    if (state.error) throw new Error(state.error);
    if (!state.building && !state.maintaining) return;
    if (performance.now() >= deadline) throw new Error('Rollup benchmark build timed out');
    await new Promise((resolve) => setTimeout(resolve, BUILD_POLL_MS));
  }
}

export async function main(rows: number) {
  if (!Number.isSafeInteger(rows) || rows <= 0) throw new Error('Message count must be a positive integer.');
  const host = testPlugin(attachmentsCore, { off: true, archive: { channels: [{ id: CHANNEL }] } });
  const measure = async (name: string, fn: () => unknown) => {
    await fn();
    const samples = [];
    for (let n = 0; n < RUNS; n++) { const start = performance.now(); await fn(); samples.push(performance.now() - start); }
    samples.sort((a, b) => a - b);
    const medianMs = Number(samples[Math.floor(RUNS / 2)]!.toFixed(2));
    console.log(JSON.stringify({ read: name, medianMs, ...(name.startsWith('after/') ? { withinBudget: medianMs <= ROLLUP_READ_BUDGET_MS } : {}) }));
  };
  try {
    console.log(JSON.stringify(seed(host.db, rows)));
    const read = host.read;
    await measure('before/totals', () => attachmentTotals(read, {}));
    await measure('before/people', () => attachmentPeople(read, { limit: PEOPLE_LIMIT }));
    await measure('before/people/bounded-history', () => attachmentPeople(read, { ...HISTORY, limit: PEOPLE_LIMIT }));
    await measure('before/places', () => attachmentPlaces(read, {}));
    await measure('before/months', () => attachmentMonths(read, {}, 'America/Los_Angeles'));
    for (const by of ['guild', 'channel', 'person', 'kind'] as const) {
      await measure(`before/breakdown/${by}`, () => attachmentBreakdown(read, {}, by));
    }
    await measure('before/counts', () => linkCounts(read, {}));
    const start = performance.now();
    host.db.prepare(`CREATE TABLE p_attachments_bench_counts AS
      SELECT channel_id, date(ts / 1000, 'unixepoch') AS day, kind, status, COUNT(*) AS n
      FROM archive_attachments GROUP BY channel_id, day, kind, status`).run();
    host.db.prepare(`CREATE TABLE p_attachments_bench_hashes AS
      SELECT a.channel_id, date(a.ts / 1000, 'unixepoch') AS day, a.kind,
        COALESCE((SELECT author_id FROM archive_messages WHERE id = a.message_id), '') AS author_id,
        CASE WHEN a.status = 'stored' THEN a.sha256 ELSE '' END AS sha256,
        MAX(CASE WHEN a.status = 'stored' THEN COALESCE(a.stored_bytes, a.size, 0) ELSE 0 END) AS bytes, COUNT(*) AS n
      FROM archive_attachments a GROUP BY a.channel_id, day, a.kind, author_id, sha256`).run();
    console.log(JSON.stringify({ candidateBuildMs: Number((performance.now() - start).toFixed(2)) }));
    for (const grain of ['counts', 'hashes']) {
      const [row] = await read<{ n: number }>(`SELECT COUNT(*) AS n FROM p_attachments_bench_${grain}`);
      console.log(JSON.stringify({ grain, rows: row!.n }));
      await measure(`candidate/${grain}/count`, () => read(`SELECT SUM(n) FROM p_attachments_bench_${grain}`));
    }
    await measure('candidate/hashes/people', () => read(`WITH files AS (
      SELECT author_id, sha256, MAX(bytes) AS bytes, SUM(n) AS n FROM p_attachments_bench_hashes GROUP BY author_id, sha256)
      SELECT author_id, SUM(n), SUM(bytes) FROM files GROUP BY author_id`));
    const [pageCount] = await read<{ n: number }>('SELECT page_count AS n FROM pragma_page_count');
    console.log(JSON.stringify({ fixtureKiB: pageCount!.n * PAGE_BYTES / BYTE_UNIT }));
    const started = performance.now();
    await host.on();
    const client = host.client('renderer');
    await built(() => client.rollupStatus());
    console.log(JSON.stringify({ buildMs: Number((performance.now() - started).toFixed(2)) }));
    for (const table of ['counts', 'files', 'counts_v1_all_time', 'files_v1_all_time']) {
      const name = table.includes('_v1') ? table : `${table}_v1`;
      const [record] = await host.read<{ n: number }>(`SELECT COUNT(*) AS n FROM p_attachments_rollup_${name}`);
      console.log(JSON.stringify({ maintainedGrain: table, rows: record!.n }));
    }
    await measure('after/totals', () => client.totals({}));
    await measure('after/people', () => client.people({ limit: PEOPLE_LIMIT }));
    await measure('after/people/bounded-history', () => client.people({ ...HISTORY, limit: PEOPLE_LIMIT }));
    await measure('after/places', () => client.places({}));
    await measure('after/months', () => client.months({}, 'America/Los_Angeles'));
    for (const by of ['guild', 'channel', 'person', 'kind'] as const) await measure(`after/breakdown/${by}`, () => client.breakdown({}, by));
  } finally { await host.dispose(); }
  const links = testPlugin(linksCore, { off: true, archive: { channels: [{ id: CHANNEL }] } });
  try {
    seed(links.db, rows);
    const client = links.client('renderer');
    await links.on();
    await built(() => client.rollupStatus());
    await measure('after/counts', () => client.counts({}));
  } finally { await links.dispose(); }
}
