import { describe, expect, it } from 'vitest';
import { BREAKDOWN_LIMIT, type AttachmentFilter, type AttachmentItem, type BreakdownBy } from '../shared/types';
import { SHARED_SHA, at, fixture, ids, seedMessage } from './attachmentsHarness';

const PAGE_LIMIT = 100;
const GENERAL = '200000000000000001';
const NORTH = '100000000000000001';
const OTHER = '200000000000000002';
const THREAD = '300000000000000001';

describe('duplicate postings', () => {
  it('counts visible hash matches independently of filters; no hash means one', async () => {
    const { client } = fixture();
    const items = await client.page({ limit: PAGE_LIMIT });
    expect(items.filter((i) => i.sha256 === SHARED_SHA).map((i) => i.postings)).toEqual([2, 2]);
    expect(items.filter((i) => !i.sha256).every((i) => i.postings === 1)).toBe(true);
    expect((await client.page({ channelId: GENERAL, name: 'photo', limit: PAGE_LIMIT }))[0]?.postings).toBe(2);
    expect(ids(await client.page({ repeated: true, limit: PAGE_LIMIT }))).toEqual(['a5', 'a1']);
    expect(ids(await client.page({ repeated: true, authorId: 'bob', presence: 'stored', limit: PAGE_LIMIT }))).toEqual(['a5']);
    expect(ids(await client.postings(SHARED_SHA))).toEqual(['a5', 'a1']);
    expect((await client.postings(SHARED_SHA))[0]).toMatchObject({ channelName: 'other', guildName: 'North', authorId: 'bob', ts: at(5) });
    await expect(client.postings("' OR 1=1 --")).rejects.toThrow(/hash/);
  });

  it('excludes privacy-hidden channels and servers from counts, filters and posting identities', async () => {
    const { client, t } = fixture();
    t.db.prepare('UPDATE attachments SET sha256 = ? WHERE id = ?').run(SHARED_SHA, 'a6');
    expect((await client.postings(SHARED_SHA))).toHaveLength(3);
    t.archive.setPrivacyMode(true);
    expect(ids(await client.postings(SHARED_SHA))).toEqual(['a1']);
    expect((await client.page({ limit: PAGE_LIMIT })).every((i) => i.postings === 1)).toBe(true);
    expect(await client.page({ repeated: true, limit: PAGE_LIMIT })).toEqual([]);
    expect((await client.totals({ repeated: true })).count).toBe(0);
  });
});

const DIMENSIONS: BreakdownBy[] = ['guild', 'channel', 'person', 'kind'];
const FILTERS: AttachmentFilter[] = [
  {}, { guildId: NORTH }, { channelId: GENERAL }, { authorId: 'bob' }, { kinds: ['image', 'video'] },
  { sinceTs: at(2), untilTs: at(7) }, { minBytes: 150 }, { presence: 'stored' }, { presence: 'gone' },
  { uncompressed: true }, { name: 'photo' }, { repeated: true },
  { guildId: NORTH, authorId: 'bob', kinds: ['image'], sinceTs: at(1), untilTs: at(6), minBytes: 80, presence: 'stored', uncompressed: true, name: 'photo', repeated: true },
];
const keyOf = (i: AttachmentItem, by: BreakdownBy): string => ({ guild: i.guildId ?? '', channel: i.channelId === THREAD ? GENERAL : i.channelId, person: i.authorId ?? '', kind: i.kind })[by];
function bytesOf(items: AttachmentItem[]): number {
  const hashes = new Map<string, number>();
  for (const i of items) if (i.sha256) hashes.set(i.sha256, Math.max(hashes.get(i.sha256) ?? 0, i.bytes));
  return [...hashes.values()].reduce((a, b) => a + b, 0);
}

describe('space breakdown', () => {
  it.each(DIMENSIONS)('groups by %s under every filter, with per-group and global hash deduplication', async (by) => {
    const { client, t } = fixture();
    for (const privateMode of [false, true]) {
      t.archive.setPrivacyMode(privateMode);
      for (const filter of FILTERS) {
        const items = await client.page({ ...filter, limit: PAGE_LIMIT });
        const groups = new Map<string, AttachmentItem[]>();
        for (const item of items) groups.set(keyOf(item, by), [...(groups.get(keyOf(item, by)) ?? []), item]);
        const expected = [...groups].map(([key, rows]) => ({ key, count: rows.length, bytes: bytesOf(rows) }))
          .sort((a, b) => b.bytes - a.bytes || b.count - a.count || a.key.localeCompare(b.key));
        const result = await client.breakdown(filter, by);
        expect(result.map(({ key, bytes, count }) => ({ key, bytes, count }))).toEqual(expected);
        for (const row of result) expect(row).toMatchObject({ totalCount: items.length, totalBytes: bytesOf(items) });
      }
    }
  });

  it('labels parent channels and people, and orders by disk bytes', async () => {
    const { client } = fixture();
    expect((await client.breakdown({}, 'guild')).map((r) => [r.label, r.bytes])).toEqual([['North', 2160], ['South', 1000]]);
    expect((await client.breakdown({}, 'channel'))[0]).toMatchObject({ key: GENERAL, label: 'general', count: 5 });
    expect((await client.breakdown({}, 'person'))[0]).toMatchObject({ key: 'bob', label: 'bob', bytes: 2100 });
    expect((await client.breakdown({ name: 'photo' }, 'person')).map((r) => r.bytes)).toEqual([100, 100]);
  });

  it('keeps orphan authors selectable as an explicit unknown-person filter', async () => {
    const { client, t } = fixture();
    t.db.prepare("UPDATE attachments SET message_id = 'missing' WHERE id = 'a1'").run();
    expect((await client.breakdown({ authorId: '' }, 'person'))[0]).toMatchObject({ key: '', label: 'Unknown person', bytes: 100, count: 1 });
    expect(ids(await client.page({ authorId: '', limit: PAGE_LIMIT }))).toEqual(['a1']);
  });

  it('limits ranked groups to fifty, with a deduplicated non-selectable remainder', async () => {
    const { client, t } = fixture();
    const MORE = 10;
    for (let n = 0; n < BREAKDOWN_LIMIT + MORE; n++) {
      const id = `extra-${n}`;
      t.archive.arrive([seedMessage({ id, channelId: OTHER, authorId: `person-${n}`, ts: at(n), filename: 'extra.png', contentType: 'image/png', size: 100 })]);
      t.db.prepare("UPDATE attachments SET sha256 = ?, status = 'stored', stored_bytes = 100 WHERE id = ?").run(SHARED_SHA, id);
    }
    const rows = await client.breakdown({ channelId: OTHER, name: 'extra' }, 'person');
    expect(rows).toHaveLength(BREAKDOWN_LIMIT + 1);
    expect(rows.at(-1)).toMatchObject({ key: null, label: 'Other', groups: MORE, count: MORE, bytes: 100, totalCount: BREAKDOWN_LIMIT + MORE, totalBytes: 100 });
  });
});
