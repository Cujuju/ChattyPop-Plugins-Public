import { describe, expect, it } from 'vitest';
import { LARGEST, type AttachmentFilter, type AttachmentItem } from '../shared/types';
import { at, files, fixture, ids, seedMessage, start } from './attachmentsHarness';

const PAGE_LIMIT = 100;
/** Below every stored file's size, so ordering by it would move the freed file last. */
const FREED_STORED_BYTES = 1;
const cursor = (item: AttachmentItem) => ({ ts: item.ts, id: item.id, key: item.sortBytes });

describe('attachment page', () => {
  it('pages newest and tied timestamps both directions, returning nearest before rows', async () => {
    const { client, t } = fixture();
    t.archive.arrive([seedMessage({ ...files[0], id: 'a9', ts: at(8) })]);
    const page = await client.page({ limit: PAGE_LIMIT });
    expect(ids(page)).toEqual(['a9', 'a8', 'a7', 'a6', 'a5', 'a4', 'a3', 'a2', 'a1']);
    const first = await client.page({ limit: 3 });
    const second = await client.page({ limit: 3, after: cursor(first.at(-1)!) });
    expect(ids(second)).toEqual(['a6', 'a5', 'a4']);
    expect(ids(await client.page({ limit: 2, before: cursor(second.at(-1)!) }))).toEqual(['a6', 'a5']);
    expect(ids(await client.page({ limit: 3, before: cursor(second[0]!) }))).toEqual(ids(first));
  });

  it('pages largest by stored bytes, falling back to original size, with time and id tie breakers', async () => {
    const { client, t } = fixture();
    t.db.prepare('UPDATE attachments SET ts = ? WHERE id = ?').run(at(8), 'a4');
    // A freed file keeps its old stored size in the row; it orders by Discord's size.
    t.db.prepare('UPDATE attachments SET stored_bytes = ? WHERE id = ?').run(FREED_STORED_BYTES, 'a3');
    const all = await client.page({ limit: PAGE_LIMIT, sort: LARGEST });
    expect(ids(all)).toEqual(['a2', 'a6', 'a3', 'a8', 'a4', 'a5', 'a1', 'a7']);
    const first = await client.page({ limit: 3, sort: LARGEST });
    const older = await client.page({ limit: 3, sort: LARGEST, after: cursor(first.at(-1)!) });
    expect(ids(older)).toEqual(['a8', 'a4', 'a5']);
    expect(ids(await client.page({ limit: 2, sort: LARGEST, before: cursor(older.at(-1)!) }))).toEqual(['a8', 'a4']);
    expect(ids(await client.page({ limit: 3, sort: LARGEST, before: cursor(older[0]!) }))).toEqual(ids(first));
    const tied = await client.page({ limit: 4, sort: LARGEST });
    expect(ids(await client.page({ limit: 1, sort: LARGEST, after: cursor(tied.at(-1)!) }))).toEqual(['a4']);
  });

  it.each([
    { sort: { key: 'name', dir: 'asc' }, key: (i: AttachmentItem) => i.filename, expected: ['a4', 'a2', 'a8', 'a1', 'a6', 'a7', 'a3', 'a5'] },
    { sort: { key: 'kind', dir: 'asc' }, key: (i: AttachmentItem) => i.kind, expected: ['a3', 'a4', 'a8', 'a1', 'a5', 'a7', 'a2', 'a6'] },
    { sort: { key: 'date', dir: 'asc' }, key: () => undefined, expected: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'] },
  ] as const)('pages $sort.key $sort.dir both directions, names ignoring case', async ({ sort, key, expected }) => {
    const { client } = fixture();
    const at = (i: AttachmentItem) => ({ ts: i.ts, id: i.id, key: key(i) });
    expect(ids(await client.page({ limit: PAGE_LIMIT, sort }))).toEqual(expected);
    const first = await client.page({ limit: 3, sort });
    const second = await client.page({ limit: 3, sort, after: at(first.at(-1)!) });
    expect(ids(second)).toEqual(expected.slice(3, 6));
    expect(ids(await client.page({ limit: 3, sort, before: at(second[0]!) }))).toEqual(expected.slice(0, 3));
  });

  const cases: { name: string; filter: AttachmentFilter; expected: string[] }[] = [
    { name: 'server', filter: { guildId: '100000000000000002' }, expected: ['a6'] },
    { name: 'channel with its thread', filter: { channelId: '200000000000000001' }, expected: ['a8', 'a7', 'a4', 'a2', 'a1'] },
    { name: 'thread alone', filter: { channelId: '300000000000000001' }, expected: ['a4'] },
    { name: 'author', filter: { authorId: 'bob' }, expected: ['a5', 'a4', 'a2'] },
    { name: 'kinds', filter: { kinds: ['audio', 'file'] }, expected: ['a8', 'a4', 'a3'] },
    { name: 'since exclusive and until inclusive', filter: { sinceTs: at(3), untilTs: at(5) }, expected: ['a5', 'a4'] },
    { name: 'minimum bytes', filter: { minBytes: 1000 }, expected: ['a6', 'a2'] },
    { name: 'stored', filter: { presence: 'stored' }, expected: ['a7', 'a6', 'a5', 'a2', 'a1'] },
    { name: 'gone', filter: { presence: 'gone' }, expected: ['a8', 'a4', 'a3'] },
    { name: 'any', filter: { presence: 'any' }, expected: ['a8', 'a7', 'a6', 'a5', 'a4', 'a3', 'a2', 'a1'] },
    { name: 'uncompressed stored media', filter: { uncompressed: true }, expected: ['a6', 'a5', 'a2', 'a1'] },
    { name: 'case insensitive filename', filter: { name: 'PHOTO' }, expected: ['a5', 'a1'] },
    { name: 'literal percent', filter: { name: '%' }, expected: ['a4'] },
    { name: 'literal underscore', filter: { name: '%_' }, expected: ['a4'] },
    { name: 'SQL text stays a bound value', filter: { name: "' OR 1=1 --" }, expected: [] },
  ];
  it.each(cases)('filters $name', async ({ filter, expected }) => {
    const { client } = fixture();
    expect(ids(await client.page({ ...filter, limit: PAGE_LIMIT }))).toEqual(expected);
  });

  it('loads Archive messages and local attachment edits, retaining removed files', async () => {
    const { client } = fixture();
    const items = await client.page({ limit: PAGE_LIMIT });
    expect(items.find((i) => i.id === 'a7')).toMatchObject({ compressed: true, storedExt: 'webp', bytes: 60 });
    expect(items.find((i) => i.id === 'a5')).toMatchObject({ spoiler: true, animated: false });
    expect(items.find((i) => i.id === 'a2')).toMatchObject({ removed: true, message: { content: 'shared file', author: { id: 'bob' } } });
    expect(items.find((i) => i.id === 'a3')).toMatchObject({ bytes: 0, sortBytes: 400 });
  });

  it('keeps orphans with safe spoiler, GIF and compressed fallbacks', async () => {
    const { client, t } = fixture();
    t.db.prepare("UPDATE attachments SET message_id = 'missing', filename = 'SPOILER_orphan.gif', content_type = 'image/gif', compressed_at = ? WHERE id = ?").run(at(9), 'a1');
    const orphan = (await client.page({ limit: PAGE_LIMIT })).find((i) => i.id === 'a1');
    expect(orphan).toMatchObject({ message: null, authorId: null, authorName: '', spoiler: true, animated: true, compressed: true });
  });

  it('hides private channel and server attachments in every read', async () => {
    const { client, t } = fixture();
    t.archive.setPrivacyMode(true);
    expect(ids(await client.page({ limit: PAGE_LIMIT }))).toEqual(['a8', 'a7', 'a4', 'a2', 'a1']);
    expect((await client.totals({})).count).toBe(5);
    expect(ids(await client.sharedBy({ userId: 'bob', limit: PAGE_LIMIT }))).toEqual(['a4', 'a2']);
    expect(await client.places({})).toEqual({ guilds: { '100000000000000001': 5 }, channels: { '200000000000000001': 5 }, threads: { '300000000000000001': 1 } });
    expect((await client.people({ limit: PAGE_LIMIT })).map((r) => [r.id, r.count])).toEqual([['bob', 2], ['alice', 3]]);
  });

  it('serves only desktop reads and resumes after off/on', async () => {
    const t = start({ archive: { channels: [{ id: '200000000000000001' }], messages: [seedMessage(files[0])] } });
    expect(t.status().status).toBe('active');
    expect(ids(await t.client('renderer').page({ limit: PAGE_LIMIT }))).toEqual(['a1']);
    expect(Object.keys(t.client('phone'))).toEqual([]);
    await t.off();
    await t.on();
    expect(ids(await t.client('renderer').page({ limit: PAGE_LIMIT }))).toEqual(['a1']);
  });
});
