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

describe('people', () => {
  it('ignores its own person filter, keeps the other filters and limits by rank', async () => {
    const { client } = fixture();
    const rows = await client.people({ authorId: 'carol', guildId: '100000000000000001', limit: 2 });
    expect(rows.map((r) => [r.id, r.count, r.bytes])).toEqual([['bob', 3, 2100], ['alice', 3, 160]]);
  });
  it('counts a shared file once per person', async () => {
    const { client, t } = fixture();
    t.db.prepare("UPDATE messages SET author_id = 'alice' WHERE id = (SELECT message_id FROM attachments WHERE id = ?)").run('a5');
    expect((await client.people({ kinds: ['image'], limit: LIMIT })).map((r) => [r.id, r.count, r.bytes])).toEqual([['alice', 3, 160]]);
  });
});

describe('places', () => {
  it('counts by server, channel and thread, a thread also in its channel, ignoring the place filter', async () => {
    const { client } = fixture();
    expect(await client.places({ guildId: '100000000000000002', channelId: '200000000000000003' })).toEqual({
      guilds: { '100000000000000001': 7, '100000000000000002': 1 },
      channels: { '200000000000000001': 5, '200000000000000002': 2, '200000000000000003': 1 },
      threads: { '300000000000000001': 1 },
    });
  });
  it('keeps the other filters', async () => {
    const { client } = fixture();
    expect(await client.places({ kinds: ['image'] })).toEqual({
      guilds: { '100000000000000001': 3 }, channels: { '200000000000000001': 2, '200000000000000002': 1 }, threads: {},
    });
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
