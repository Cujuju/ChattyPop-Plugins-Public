import { describe, expect, it } from 'vitest';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { attachmentPeople, attachmentPlaces, attachmentTotals } from '../core/totals';
import { attachmentMonths } from '../core/months';
import { attachmentBreakdown } from '../core/space';
import { fixture, at, seedMessage, files } from './attachmentsHarness';
import type { AttachmentFilter } from '../shared/types';

const LIMIT = 100; // Exercises the complete fixture's person ranking.
const ZONES = ['UTC', 'America/Los_Angeles', 'Asia/Kathmandu'];
const SETTLE_TIMEOUT_MS = 10_000; // Native worker startup can exceed Vitest's one-second polling default under concurrent checks.

describe('attachment rollup equivalence', () => {
  it('matches live folds across filters, boundaries, edits, file states, deletes, privacy and rebuilds', async () => {
    const { t, client } = fixture();
    const later = { ...files[0], id: 'later', ts: at(1) + MS_PER_DAY };
    const earlier = { ...files[1], id: 'earlier', ts: at(1) - MS_PER_DAY };
    t.archive.arrive([seedMessage(later), seedMessage(earlier)]);
    t.db.prepare("UPDATE attachments SET status = 'stored', sha256 = ?, stored_bytes = 200 WHERE id = 'later'").run(files[0].sha);
    const settled = async () => {
      await expect.poll(async () => { const s = await client.rollupStatus(); expect(s.error).toBeNull(); return s.building; }, { timeout: SETTLE_TIMEOUT_MS }).toBe(false);
    };
    const same = async (filter: AttachmentFilter) => {
      expect(await client.totals(filter)).toEqual(await attachmentTotals(t.read, filter));
      expect(await client.people({ ...filter, limit: LIMIT })).toEqual(await attachmentPeople(t.read, { ...filter, limit: LIMIT }));
      expect(await client.places(filter)).toEqual(await attachmentPlaces(t.read, filter));
      for (const zone of ZONES) expect(await client.months(filter, zone)).toEqual(await attachmentMonths(t.read, filter, zone));
      for (const by of ['guild', 'channel', 'person', 'kind'] as const) expect(await client.breakdown(filter, by)).toEqual(await attachmentBreakdown(t.read, filter, by));
    };
    await settled();
    for (const filter of [{}, { presence: 'stored' }, { presence: 'gone' }, { uncompressed: true }, { kinds: ['image'] },
      { authorId: 'alice' }, { guildId: '100000000000000001' }, { channelId: '200000000000000001' },
      { sinceTs: at(1) - MS_PER_DAY, untilTs: at(4) }, { sinceTs: at(1), untilTs: at(4) }, { sinceTs: at(1), untilTs: at(1) },
      { minBytes: 100 }, { repeated: true }, { name: 'photo' }] satisfies AttachmentFilter[]) await same(filter);
    t.db.prepare("UPDATE attachments SET status = 'evicted' WHERE id = 'a1'").run();
    t.db.prepare("UPDATE attachments SET status = 'evicted' WHERE id = 'later'").run();
    t.db.prepare("UPDATE attachments SET stored_bytes = 30, compressed_at = 1 WHERE id = 'a7'").run();
    t.db.prepare("UPDATE messages SET content = '<#200000000000000002>' WHERE id = (SELECT message_id FROM attachments WHERE id = 'a2')").run();
    t.db.prepare("DELETE FROM attachments WHERE id = 'a4'").run();
    await settled();
    await same({});
    t.archive.setPrivacyMode(true);
    await same({});
    expect((await client.people({ limit: LIMIT })).every((p) => p.id !== 'carol')).toBe(true);
    t.archive.setPrivacyMode(false);
    await same({});
    const incremental = await client.totals({});
    await client.rebuildRollups(['200000000000000001']);
    await settled();
    expect(await client.totals({})).toEqual(incremental);
    await client.rebuildRollups();
    await settled();
    await same({});
  });
});
