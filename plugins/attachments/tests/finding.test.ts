import { describe, expect, it } from 'vitest';
import type { AttachmentFilter } from '../shared/types';
import { fixture, ids } from './attachmentsHarness';
import { monthBounds, monthOf } from '../shared/months';

const LIMIT = 100;
const LONG_CONTEXT = 80;
const MONTH_INDEX: Record<string, number> = { a1: 0, a2: 0, a3: 1, a4: 1, a5: 2, a6: 2, a7: 2, a8: 3 };

describe('derived file text', () => {
  it('matches scoped text and transcripts with snippets; filename matches have no text badge', async () => {
    const { t, client } = fixture();
    const rows = await client.page({ limit: LIMIT });
    const add = t.db.prepare('INSERT INTO derived_texts (message_id, source, ord, text, part) VALUES (?, ?, ?, ?, ?)');
    const messageId = (id: string): string => rows.find((r) => r.id === id)!.messageId;
    add.run(messageId('a1'), 'ocr:picture', 1, `${'x'.repeat(LONG_CONTEXT)}  nebula\n\tmap  ${'z'.repeat(LONG_CONTEXT)}`, 'attachment:a1');
    add.run(messageId('a2'), 'transcription:clip', 1, 'A spoken NEBULA map.', 'attachment:a2');
    add.run(messageId('a5'), 'ocr:name', 1, 'photo', 'attachment:a5');
    expect((await client.page({ limit: LIMIT, name: 'NEBULA' })).map((r) => [r.id, r.textMatch])).toEqual([
      ['a2', { source: 'transcript', snippet: 'A spoken NEBULA map.' }],
      ['a1', { source: 'text', snippet: `…${'x'.repeat(19)} nebula map ${'z'.repeat(29)}…` }],
    ]);
    expect((await client.page({ limit: LIMIT, name: 'photo' })).every((r) => r.textMatch === undefined)).toBe(true);
    expect((await client.totals({ name: 'nebula' })).count).toBe(2);
    expect((await client.people({ name: 'nebula', limit: LIMIT })).map((r) => r.id).sort()).toEqual(['alice', 'bob']);
    expect(await client.places({ name: 'nebula' })).toEqual({ guilds: { '100000000000000001': 2 }, channels: { '200000000000000001': 2 }, threads: {} });
  });

  it("matches a spoiler's text without sending its words", async () => {
    const { t, client } = fixture();
    const rows = await client.page({ limit: LIMIT });
    const spoiler = rows.find((r) => r.id === 'a5')!;
    expect(spoiler.spoiler).toBe(true);
    t.db.prepare('INSERT INTO derived_texts (message_id, source, ord, text, part) VALUES (?, ?, ?, ?, ?)')
      .run(spoiler.messageId, 'ocr:picture', 1, 'secret nebula plans', 'attachment:a5');
    expect((await client.page({ limit: LIMIT, name: 'nebula' })).map((r) => [r.id, r.textMatch])).toEqual([['a5', { source: 'text' }]]);
  });

  it('never leaks a sibling or embed part, and uses message-wide legacy text only without identified parts', async () => {
    const { t, client } = fixture();
    const item = (await client.page({ limit: LIMIT })).find((r) => r.id === 'a1')!;
    t.db.prepare(`INSERT INTO attachments (id, message_id, channel_id, filename, url, ts)
      SELECT 'sibling', message_id, channel_id, 'sibling.bin', url, ts FROM attachments WHERE id = 'a1'`).run();
    const add = t.db.prepare('INSERT INTO derived_texts (message_id, source, ord, text, part) VALUES (?, ?, ?, ?, ?)');
    add.run(item.messageId, 'ocr:legacy', 1, 'legacy comet', null);
    expect(new Set(ids(await client.page({ limit: LIMIT, name: 'comet' })))).toEqual(new Set(['a1', 'sibling']));
    add.run(item.messageId, 'ocr:scoped', 2, 'scoped nebula', 'attachment:a1');
    add.run(item.messageId, 'ocr:sibling', 3, 'sibling Jupiter', 'attachment:sibling');
    add.run(item.messageId, 'ocr:embed', 4, 'embed Saturn', 'embed:https://example.com');
    expect(ids(await client.page({ limit: LIMIT, name: 'nebula' }))).toEqual(['a1']);
    expect(ids(await client.page({ limit: LIMIT, name: 'Jupiter' }))).toEqual(['sibling']);
    expect(ids(await client.page({ limit: LIMIT, name: 'Saturn' }))).toEqual([]);
    expect(ids(await client.page({ limit: LIMIT, name: 'comet' }))).toEqual([]);
  });

  it('binds literal wildcard characters and hides derived matches with their messages', async () => {
    const { t, client } = fixture();
    const item = (await client.page({ limit: LIMIT })).find((r) => r.id === 'a6')!;
    t.db.prepare('INSERT INTO derived_texts (message_id, source, ord, text, part) VALUES (?, ?, 1, ?, ?)')
      .run(item.messageId, 'ocr:secret', 'literal 42%_\\ and hidden needle', 'attachment:a6');
    expect(ids(await client.page({ limit: LIMIT, name: '42%_\\' }))).toEqual(['a6']);
    expect(ids(await client.page({ limit: LIMIT, name: "' OR 1=1 --" }))).toEqual([]);
    t.archive.setPrivacyMode(true);
    expect(ids(await client.page({ limit: LIMIT, name: 'needle' }))).toEqual([]);
    expect(await client.months({ name: 'needle' })).toEqual([]);
    expect((await client.totals({ name: 'needle' })).count).toBe(0);
  });
});

describe('calendar months', () => {
  it('counts newest first under every current filter, including thread scope and privacy', async () => {
    const { t, client } = fixture();
    const update = t.db.prepare('UPDATE attachments SET ts = ? WHERE id = ?');
    for (const [id, index] of Object.entries(MONTH_INDEX)) update.run(new Date(2026, index, 15).getTime(), id);
    const cases: [AttachmentFilter, [string, number][]][] = [
      [{}, [['2026-04', 1], ['2026-03', 3], ['2026-02', 2], ['2026-01', 2]]],
      [{ channelId: '200000000000000001' }, [['2026-04', 1], ['2026-03', 1], ['2026-02', 1], ['2026-01', 2]]],
      [{ authorId: 'bob' }, [['2026-03', 1], ['2026-02', 1], ['2026-01', 1]]],
      [{ kinds: ['video'], minBytes: 1500, presence: 'stored', uncompressed: true }, [['2026-01', 1]]],
      [{ presence: 'gone', name: 'budget' }, [['2026-04', 1], ['2026-02', 1]]],
      [{ sinceTs: new Date(2026, 1, 1).getTime(), untilTs: new Date(2026, 2, 31).getTime() }, [['2026-03', 3], ['2026-02', 2]]],
    ];
    for (const [filter, expected] of cases) expect((await client.months(filter)).map((r) => [r.month, r.count])).toEqual(expected);
    t.archive.setPrivacyMode(true);
    expect(await client.months({})).toEqual([{ month: '2026-04', count: 1 }, { month: '2026-03', count: 1 }, { month: '2026-02', count: 1 }, { month: '2026-01', count: 2 }]);
    expect(await client.months({ name: 'absent' })).toEqual([]);
  });

  it.each(['asc', 'desc'] as const)('starts a %s window in the month and pages both ways beyond it', async (dir) => {
    const { t, client } = fixture();
    const update = t.db.prepare('UPDATE attachments SET ts = ? WHERE id = ?');
    for (const [id, index] of Object.entries(MONTH_INDEX)) update.run(new Date(2026, index, 15).getTime(), id);
    const sort = { key: 'date' as const, dir };
    const first = await client.page({ limit: 2, sort, startMonth: '2026-02' });
    expect(ids(first)).toEqual(dir === 'asc' ? ['a3', 'a4'] : ['a4', 'a3']);
    const cursor = (i: typeof first[number]) => ({ ts: i.ts, id: i.id });
    const before = await client.page({ limit: LIMIT, sort, before: cursor(first[0]!) });
    const after = await client.page({ limit: LIMIT, sort, after: cursor(first.at(-1)!) });
    expect(ids(before)).toEqual(dir === 'asc' ? ['a1', 'a2'] : ['a8', 'a7', 'a6', 'a5']);
    expect(ids(after)).toEqual(dir === 'asc' ? ['a5', 'a6', 'a7', 'a8'] : ['a2', 'a1']);
    expect(ids(await client.page({ limit: LIMIT, sort, startAt: cursor(first[0]!) }))).toEqual([...ids(first), ...ids(after)]);
    expect(await client.page({ limit: LIMIT, startMonth: 'invalid' })).toEqual([]);
  });

  it('uses local calendar boundaries rather than a fixed month duration', () => {
    expect(monthBounds('2026-12')).toEqual({ start: new Date(2026, 11).getTime(), end: new Date(2027, 0).getTime() });
    expect(monthBounds('2026-00')).toBeNull();
    expect(monthBounds('2026-13')).toBeNull();
  });

  it("follows the viewer's zone, daylight-saving changes included, wherever the core runs", async () => {
    // Los Angeles: PST (UTC-8) on March 1, PDT (UTC-7) by April 1. London: back on GMT by November 1.
    expect(monthBounds('2026-03', 'America/Los_Angeles')).toEqual({ start: Date.UTC(2026, 2, 1, 8), end: Date.UTC(2026, 3, 1, 7) });
    expect(monthBounds('2026-11', 'Europe/London')!.start).toBe(Date.UTC(2026, 10, 1));
    expect(monthOf(Date.UTC(2026, 2, 31, 20), 'Pacific/Auckland')).toBe('2026-04');
    expect(monthOf(Date.UTC(2026, 2, 31, 20), 'UTC')).toBe('2026-03');
    const { t, client } = fixture();
    // a1 is March 31 in UTC but April 1 in Auckland; the rest stay in January.
    t.db.prepare('UPDATE attachments SET ts = ?').run(Date.UTC(2026, 0, 15));
    t.db.prepare('UPDATE attachments SET ts = ? WHERE id = ?').run(Date.UTC(2026, 2, 31, 20), 'a1');
    expect((await client.months({}, 'UTC')).map((r) => r.month)).toEqual(['2026-03', '2026-01']);
    expect((await client.months({}, 'Pacific/Auckland')).map((r) => r.month)).toEqual(['2026-04', '2026-01']);
    const sort = { key: 'date' as const, dir: 'asc' as const };
    expect(ids(await client.page({ limit: 1, sort, startMonth: '2026-04', timeZone: 'Pacific/Auckland' }))).toEqual(['a1']);
    expect(await client.page({ limit: 1, sort, startMonth: '2026-04', timeZone: 'UTC' })).toEqual([]);
  });
});
