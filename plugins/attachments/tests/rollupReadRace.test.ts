import { expect, it, onTestFinished } from 'vitest';
import { defineCorePlugin, type ArchiveRead, type Rollup } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import core from '../core';
import { plugin } from '../shared';
import { attachmentPeople, attachmentPlaces, attachmentTotals } from '../core/totals';
import { attachmentMonths } from '../core/months';
import { attachmentBreakdown } from '../core/space';
import { files, seedMessage } from './attachmentsHarness';

const SETTLE_TIMEOUT_MS = 10_000; // Native helpers start on demand, including on a busy test runner.
const PEOPLE_LIMIT = 50; // The fixture contains one person; this keeps the same bounded panel contract.

it('falls back live when an attachment changes between a rollup read and its result', async () => {
  const registered = new Map<string, Rollup>();
  const wrapped = defineCorePlugin(plugin, (ctx) => core.activate({ ...ctx, rollups: {
    define: (name, spec) => { const rollup = ctx.rollups.define(name, spec); registered.set(name, rollup); return rollup; },
  } }));
  const file = files[0];
  const t = testPlugin(wrapped, { archive: { channels: [{ id: file.channelId }], messages: [seedMessage(file)] } });
  onTestFinished(() => t.dispose());
  const client = t.client('renderer');
  const rollups = { counts: registered.get('counts')!, files: registered.get('files')! };
  const filter = { presence: 'stored' } as const;
  const cases = [
    (read: ArchiveRead, rolled: boolean) => attachmentTotals(read, filter, rolled ? rollups : undefined),
    (read: ArchiveRead, rolled: boolean) => attachmentPeople(read, { ...filter, limit: PEOPLE_LIMIT }, rolled ? rollups : undefined),
    (read: ArchiveRead, rolled: boolean) => attachmentPlaces(read, filter, rolled ? rollups : undefined),
    (read: ArchiveRead, rolled: boolean) => attachmentMonths(read, filter, 'America/Los_Angeles', rolled ? rollups : undefined),
    (read: ArchiveRead, rolled: boolean) => attachmentBreakdown(read, filter, 'kind', rolled ? rollups : undefined),
  ];
  for (const query of cases) {
    t.db.prepare("UPDATE attachments SET status = 'stored', sha256 = ?, stored_bytes = ? WHERE id = ?").run(file.sha, file.bytes, file.id);
    await expect.poll(async () => (await client.rollupStatus()).maintaining, { timeout: SETTLE_TIMEOUT_MS }).toBe(false);
    const sources: boolean[] = [];
    const read: ArchiveRead = async <R,>(sql: string, params: Parameters<ArchiveRead>[1] = [], options: Parameters<ArchiveRead>[2] = {}) => {
      sources.push(sql.includes('p_attachments_rollup'));
      const rows = await t.read<R>(sql, params, options);
      if (sources.length === 1) t.db.prepare("UPDATE attachments SET status = 'evicted' WHERE id = ?").run(file.id);
      return rows;
    };
    expect(await query(read, true)).toEqual(await query(t.read, false));
    expect(sources[0]).toBe(true);
    expect(sources.at(-1)).toBe(false);
  }
});
