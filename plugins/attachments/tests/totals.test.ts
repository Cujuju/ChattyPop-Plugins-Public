import { describe, expect, it } from 'vitest';
import { fixture, ids } from './attachmentsHarness';

const LIMIT = 100;

describe('disk totals', () => {
  it('ignores kind filters, counts each attachment and counts shared SHA bytes once', async () => {
    const { client } = fixture();
    const totals = await client.totals({ kinds: ['audio'] });
    expect(totals).toEqual({ count: 8, bytes: 3160, byKind: {
      image: { count: 3, bytes: 160 }, video: { count: 2, bytes: 3000 }, audio: { count: 1, bytes: 0 }, file: { count: 2, bytes: 0 },
    } });
    expect(await client.totals({ presence: 'stored' })).toMatchObject({ count: 5, bytes: 3160 });
    expect(await client.totals({ presence: 'gone' })).toMatchObject({ count: 3, bytes: 0 });
  });

  it('deduplicates SHA globally even when it appears under two media kinds', async () => {
    const { client, t } = fixture();
    t.db.prepare("UPDATE attachments SET content_type = 'video/mp4', filename = 'shared.mp4' WHERE id = ?").run('a5');
    const totals = await client.totals({});
    expect(totals.bytes).toBe(3160);
    expect(totals.byKind.image.bytes).toBe(160);
    expect(totals.byKind.video.bytes).toBe(3100);
  });

  it('applies the remaining filters and returns every kind with zero counts for an empty scope', async () => {
    const { client } = fixture();
    expect(await client.totals({ channelId: '200000000000000001', authorId: 'bob', presence: 'stored' })).toMatchObject({ count: 1, bytes: 2000 });
    expect(await client.totals({ channelId: 'missing' })).toEqual({ count: 0, bytes: 0, byKind: {
      image: { count: 0, bytes: 0 }, video: { count: 0, bytes: 0 }, audio: { count: 0, bytes: 0 }, file: { count: 0, bytes: 0 },
    } });
  });
});

describe('breakdown', () => {
  it('ranks servers by stored bytes and ignores its own server filter', async () => {
    const { client } = fixture();
    expect(await client.breakdown({ by: 'guild', guildId: '100000000000000002', limit: LIMIT })).toEqual([
      { id: '100000000000000001', name: 'North', detail: '', count: 7, bytes: 2160 }, { id: '100000000000000002', name: 'South', detail: '', count: 1, bytes: 1000 },
    ]);
  });
  it('ignores its own channel filter and deduplicates files within each channel', async () => {
    const { client, t } = fixture();
    t.db.prepare('UPDATE attachments SET channel_id = ? WHERE id = ?').run('200000000000000001', 'a5');
    const rows = await client.breakdown({ by: 'channel', channelId: '200000000000000002', limit: LIMIT });
    expect(rows[0]).toEqual({ id: '200000000000000001', name: 'general', detail: 'North', count: 5, bytes: 2160 });
    expect(rows.map((r) => r.id)).toEqual(['200000000000000001', '200000000000000003', '200000000000000002', '300000000000000001']);
  });
  it('ignores its own author filter, keeps the other filters and limits by rank', async () => {
    const { client } = fixture();
    const rows = await client.breakdown({ by: 'author', authorId: 'carol', guildId: '100000000000000001', limit: 2 });
    expect(rows.map((r) => [r.id, r.count, r.bytes])).toEqual([['bob', 3, 2100], ['alice', 3, 160]]);
  });
  it('breakdown retains kind filters', async () => {
    const { client } = fixture();
    expect((await client.breakdown({ by: 'channel', kinds: ['audio'], limit: LIMIT })).map((r) => [r.id, r.count, r.bytes])).toEqual([['200000000000000002', 1, 0]]);
  });
});

describe('person files', () => {
  it('lists their shares newest first and respects the requested limit', async () => {
    const { client } = fixture();
    expect(ids(await client.sharedBy({ userId: 'bob', limit: LIMIT }))).toEqual(['a5', 'a4', 'a2']);
    expect(ids(await client.sharedBy({ userId: 'bob', limit: 2 }))).toEqual(['a5', 'a4']);
    expect(await client.sharedBy({ userId: 'nobody', limit: LIMIT })).toEqual([]);
  });
});
