import { archiveRead } from '@core/plugins/pluginDb';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { snowflakeFromMs } from '@shared/discord';
import { MS_PER_MIN } from '@shared/units';
import { Archive } from '@core/archive';
import type { Db } from '@core/db';
import { exportChannels, importDceFiles } from '../core/exchange';
import type { ExportFormat, ExportRequest } from '../shared/types';
import { messagePage } from '@core/queries/messages';
import { rawMessage, seedArchive, tempDb, tempDir } from '@chattypop/host-testing';
import { attachmentStored } from '@core/mediaQueue';
import { storedAttachmentPath } from '@core/attachmentRetention';
import type { DceExport, DceMessage } from '../core/dce';
import { ARRIVAL } from '@core/arrival';

const CH = '200000000000000001';
const LONG = '200000000000000003';
const T0 = Date.UTC(2026, 8, 1);

let db: Db;
beforeEach(() => {
  db = tempDb();
  const a = seedArchive(db, [{ id: CH, name: 'general' }]);
  const first = rawMessage(CH, T0, 'hello <b>world</b>', {
    embeds: [{ type: 'link', url: 'https://example.com', title: 'Example', color: 0x5865f2 }],
    reactions: [{ emoji: { id: null, name: '👍' }, count: 2 }],
    attachments: [{ id: '500000000000000001', filename: 'a.txt', size: 3, url: 'https://cdn.discordapp.com/a.txt' }],
  });
  const reply = rawMessage(CH, T0 + MS_PER_MIN, 'yes', { type: 19, message_reference: { message_id: first.id, channel_id: CH } });
  a.ingestMessages([first, reply], ARRIVAL.gateway);
});

/** An export of CH alone, without threads or media, into a fresh folder. */
const request = (over: Partial<ExportRequest> = {}): ExportRequest => ({ channelIds: [CH], includeThreads: false, format: 'json', includeMedia: false, dir: tempDir(), ...over });
const exportTo = async (format: ExportFormat) => {
  const req = request({ format });
  const r = await exportChannels(archiveRead(() => db), tempDir(), req);
  return { r, dir: req.dir, file: join(req.dir, readdirSync(req.dir)[0]!) };
};
/** Clear of the seeded messages: a message's id is its time. */
const LONG_T0 = T0 + 10 * MS_PER_MIN;
/** A second channel of `count` messages a millisecond apart, from `startMs`. */
const fillLong = (count: number, startMs = LONG_T0): void => {
  const a = new Archive(db);
  a.upsertChannels('g1', [{ id: LONG, name: 'long', type: 0 }]);
  a.setOptIn(LONG, true);
  a.ingestMessages(Array.from({ length: count }, (_, i) => rawMessage(LONG, startMs + i, `m${i}`)), ARRIVAL.gateway);
};

describe('archive exchange (DiscordChatExporter format)', () => {
  it('round-trips a channel through a DCE JSON export', async () => {
    const { r, file } = await exportTo('json');
    expect(r).toEqual({ channelIds: [CH], messages: 2, emptyChannelIds: [], failedChannelIds: [], cancelled: false });

    const target = tempDb();
    const imported = importDceFiles(new Archive(target), [file]);
    expect(imported).toEqual({ channelIds: [CH], messages: 2, skippedFiles: [] });
    const [first, reply] = messagePage(target, { channelId: CH, limit: 10 });
    expect(first).toMatchObject({ content: 'hello <b>world</b>', author: { name: 'Alice' } });
    expect(first!.embeds[0]).toMatchObject({ url: 'https://example.com', title: 'Example', color: 0x5865f2 });
    expect(first!.reactions).toEqual([{ emoji: { id: null, name: '👍', animated: false }, count: 2, me: false }]);
    expect(first!.attachments[0]).toMatchObject({ filename: 'a.txt', status: 'pending' });
    expect(reply).toMatchObject({ content: 'yes', replyToId: first!.id });
    expect(target.prepare('SELECT opted_in FROM channels WHERE id = ?').pluck().get(CH)).toBe(1);
  });

  it('writes a standalone HTML page with message text escaped', async () => {
    const html = readFileSync((await exportTo('html')).file, 'utf8');
    expect(html).toContain('hello &lt;b&gt;world&lt;/b&gt;');
    expect(html).toContain(`href="#m${snowflakeFromMs(T0)}"`);
    expect(html).toContain('<footer>2 messages</footer>');
    expect(html).not.toMatch(/<script/i);
  });

  it('skips files that are not DCE exports', () => {
    const bad = join(tempDir(), 'x.json');
    writeFileSync(bad, '{"hello": 1}');
    expect(importDceFiles(new Archive(tempDb()), [bad]).skippedFiles).toEqual([bad]);
  });

  /** A DCE export of `messages` in a fresh channel, written to a file. */
  const dceFile = (messages: unknown[], channelId = '200000000000000009', name = 'imported'): string => {
    const file = join(tempDir(), `${channelId}.json`);
    const doc = { guild: { id: '100000000000000009', name: 'Other' }, channel: { id: channelId, type: 'GuildTextChat', name }, messages };
    writeFileSync(file, JSON.stringify(doc));
    return file;
  };
  const dceMessage = (i: number, over: Partial<DceMessage> = {}): DceMessage => ({
    id: snowflakeFromMs(T0 + i),
    type: 'Default',
    timestamp: new Date(T0 + i).toISOString(),
    content: `message ${i}`,
    author: { id: '300000000000000001', name: 'bob' },
    ...over,
  });

  it('never lets an imported or archived payload run script or load code in the HTML export', async () => {
    const hostile = [
      dceMessage(1, {
        content: '<img src=x onerror=alert(1)>',
        embeds: [{ title: 'click', url: 'javascript:alert(1)', color: '#fff;background:url(https://evil.example/x)', images: [{ url: 'javascript:alert(2)' }] }],
        attachments: [{ id: '500000000000000009', url: ' JaVaScRiPt:alert(3)', fileName: 'x.png' }],
        reactions: [{ emoji: { name: '<script>alert(4)</script>' }, count: 1 }],
      }),
    ];
    const target = tempDb();
    const imported = importDceFiles(new Archive(target), [dceFile(hostile)]);
    expect(imported.skippedFiles).toEqual([]);
    // A payload the archive already holds (any source): a count that isn't a number.
    new Archive(target).ingestMessages([rawMessage('200000000000000009', T0 + 5, 'x', { reactions: [{ emoji: { id: null, name: 'a' }, count: '<script>alert(5)</script>' as unknown as number }] })], ARRIVAL.gateway);
    const html = request({ channelIds: ['200000000000000009'], format: 'html' });
    await exportChannels(archiveRead(() => target), tempDir(), html);
    const page = readFileSync(join(html.dir, readdirSync(html.dir)[0]!), 'utf8');
    // Hostile text may appear escaped, as text; never as an element, attribute or link.
    expect(page).not.toMatch(/<script|<img[^>]*onerror|(?:href|src)="\s*javascript:|style="[^"]*url\(/i);
    expect(page).toContain("script-src 'none'");
    // Markdown links only what a browser may open; the rest stays text.
    const md = request({ channelIds: ['200000000000000009'], format: 'md' });
    await exportChannels(archiveRead(() => target), tempDir(), md);
    expect(readFileSync(join(md.dir, readdirSync(md.dir)[0]!), 'utf8')).not.toMatch(/\]\(<?\s*javascript:/i);
  });

  it('skips an import whose fields have the wrong types, without importing any of it', () => {
    const counted = dceFile([dceMessage(1, { reactions: [{ emoji: { name: 'a' }, count: '<script>' as unknown as number }] })]);
    const nullContent = dceFile([...Array.from({ length: 501 }, (_, i) => dceMessage(i)), dceMessage(501, { content: null as unknown as string })], '200000000000000008');
    const target = tempDb();
    expect(importDceFiles(new Archive(target), [counted, nullContent])).toEqual({ channelIds: [], messages: 0, skippedFiles: [counted, nullContent] });
    expect(target.prepare('SELECT COUNT(*) FROM messages').pluck().get()).toBe(0);
  });

  it('imports each file whole or not at all, and reports the files that made it', () => {
    const good = dceFile([dceMessage(1)], '200000000000000007', 'good');
    const failing = dceFile(Array.from({ length: 502 }, (_, i) => dceMessage(i, i === 501 ? { content: 'boom' } : {})), '200000000000000008', 'failing');
    const target = tempDb();
    target.exec("CREATE TRIGGER boom BEFORE INSERT ON messages WHEN NEW.content = 'boom' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const archive = new Archive(target);
    expect(importDceFiles(archive, [good, failing])).toEqual({ channelIds: ['200000000000000007'], messages: 1, skippedFiles: [failing] });
    expect(target.prepare("SELECT COUNT(*) FROM messages WHERE channel_id = '200000000000000008'").pluck().get()).toBe(0);
    expect(archive.isOptedIn('200000000000000008')).toBe(false);
  });

  it('gives channels with the same names their own export file and media folder', async () => {
    const OTHER = '200000000000000002';
    const a = new Archive(db);
    a.upsertChannels('g1', [{ id: OTHER, name: 'general', type: 0 }]);
    a.setOptIn(OTHER, true);
    a.ingestMessages([rawMessage(OTHER, T0 + 5, 'the other general')], ARRIVAL.gateway);
    const req = request({ channelIds: [CH, OTHER] });
    expect((await exportChannels(archiveRead(() => db), tempDir(), req)).channelIds).toEqual([CH, OTHER]);
    const docs = readdirSync(req.dir).map((f) => JSON.parse(readFileSync(join(req.dir, f), 'utf8')) as DceExport);
    expect(docs.map((d) => d.messages.map((m) => m.content))).toEqual(expect.arrayContaining([['hello <b>world</b>', 'yes'], ['the other general']]));
  });

  it('links copied media by URL-encoded path, so # and % in names reach the file', async () => {
    db.prepare("UPDATE guilds SET name = 'Guild #1 100%'").run();
    const sha = 'c'.repeat(64);
    const attachmentsDir = tempDir();
    const src = storedAttachmentPath(attachmentsDir, { sha256: sha, filename: 'a.txt', storedExt: null });
    mkdirSync(join(src, '..'), { recursive: true });
    writeFileSync(src, 'abc');
    attachmentStored(db, '500000000000000001', sha, 3);
    const req = request({ format: 'html', includeMedia: true });
    await exportChannels(archiveRead(() => db), attachmentsDir, req);
    const html = readFileSync(join(req.dir, readdirSync(req.dir).find((f) => f.endsWith('.html'))!), 'utf8');
    const href = /<a href="([^"]+)">a\.txt<\/a>/.exec(html)![1]!;
    const target = decodeURIComponent(new URL(href, 'file:///export/').pathname).slice('/export/'.length);
    expect(existsSync(join(req.dir, target))).toBe(true);
  });

  it('exports a compressed attachment from its stored extension', async () => {
    const sha256 = 'd'.repeat(64);
    const attachmentsDir = tempDir();
    const src = storedAttachmentPath(attachmentsDir, { sha256, filename: 'a.txt', storedExt: 'webp' });
    mkdirSync(join(src, '..'), { recursive: true });
    writeFileSync(src, 'small');
    attachmentStored(db, '500000000000000001', sha256, 5);
    db.prepare("UPDATE attachments SET stored_ext = 'webp' WHERE id = '500000000000000001'").run();
    const req = request({ format: 'json', includeMedia: true });
    await exportChannels(archiveRead(() => db), attachmentsDir, req);
    const doc = JSON.parse(readFileSync(join(req.dir, readdirSync(req.dir).find((f) => f.endsWith('.json'))!), 'utf8')) as DceExport;
    const url = doc.messages.flatMap((m) => m.attachments ?? []).find((a) => a.id === '500000000000000001')!.url;
    expect(url).toMatch(/\.webp$/);
    expect(readFileSync(join(req.dir, url), 'utf8')).toBe('small');
  });

  it('writes JSON in pieces as JSON.stringify would write the whole document', async () => {
    const text = readFileSync((await exportTo('json')).file, 'utf8');
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect((JSON.parse(text) as DceExport).messageCount).toBe(2);
  });

  it('writes a channel longer than one page whole, in order, once each', async () => {
    const COUNT = 2001;
    fillLong(COUNT);
    const req = request({ channelIds: [LONG] });
    const reported: number[] = [];
    const r = await exportChannels(archiveRead(() => db), tempDir(), req, { stopped: () => false, progress: (p) => reported.push(p.messages) });
    expect(r.messages).toBe(COUNT);
    const text = readFileSync(join(req.dir, readdirSync(req.dir)[0]!), 'utf8');
    const doc = JSON.parse(text) as DceExport;
    expect(doc.messages.map((m) => m.content)).toEqual(Array.from({ length: COUNT }, (_, i) => `m${i}`));
    expect(doc.messageCount).toBe(COUNT);
    expect(text).toBe(JSON.stringify(doc, null, 2));
    // One report per page, then the channel's.
    expect(reported).toEqual([1000, 2000, COUNT, COUNT]);
  });

  it('stops between pages, leaving no partial file and an earlier export of the channel as it was', async () => {
    fillLong(1);
    const req = request({ channelIds: [CH, LONG] });
    await exportChannels(archiveRead(() => db), tempDir(), req);
    const before = readdirSync(req.dir).sort();
    const longFile = join(req.dir, before.find((f) => f.includes(LONG))!);
    const earlier = readFileSync(longFile, 'utf8');
    fillLong(2000, LONG_T0 + 1);
    // Reports: CH's page, CH done, then LONG's first page.
    let reports = 0;
    const r = await exportChannels(archiveRead(() => db), tempDir(), req, { stopped: () => reports > 2, progress: () => void reports++ });
    expect(r).toMatchObject({ channelIds: [CH], messages: 2, cancelled: true });
    expect(readdirSync(req.dir).sort()).toEqual(before);
    expect(readFileSync(longFile, 'utf8')).toBe(earlier);
  });

  it("exports a channel's threads with it when asked, each to its own file", async () => {
    const THREAD = '200000000000000004';
    const FORUM = '200000000000000005';
    const POST = '200000000000000006';
    const a = new Archive(db);
    a.upsertChannels('g1', [
      { id: THREAD, name: 'side talk', type: 11, parent_id: CH },
      { id: FORUM, name: 'help', type: 15 },
      { id: POST, name: 'a question', type: 11, parent_id: FORUM },
    ]);
    [FORUM, THREAD, POST].forEach((id) => a.setOptIn(id, true));
    a.ingestMessages([rawMessage(THREAD, T0 + 5, 'in the thread'), rawMessage(POST, T0 + 6, 'in the post')], ARRIVAL.gateway);
    expect(await exportChannels(archiveRead(() => db), tempDir(), request({ channelIds: [CH, FORUM] }))).toMatchObject({ channelIds: [CH], emptyChannelIds: [FORUM] });
    const req = request({ channelIds: [CH, FORUM, THREAD], includeThreads: true });
    expect(await exportChannels(archiveRead(() => db), tempDir(), req)).toMatchObject({ channelIds: [CH, THREAD, POST], messages: 4, emptyChannelIds: [] });
    expect(readdirSync(req.dir).find((f) => f.includes(THREAD))).toContain('general - side talk');
  });

  it('bounds the range at both ends and writes no file for a channel with nothing in it', async () => {
    expect(await exportChannels(archiveRead(() => db), tempDir(), request({ untilTs: T0 }))).toMatchObject({ channelIds: [CH], messages: 1 });
    const none = request({ sinceTs: T0 + MS_PER_MIN + 1, untilTs: T0 + 2 * MS_PER_MIN });
    expect(await exportChannels(archiveRead(() => db), tempDir(), none)).toMatchObject({ channelIds: [], messages: 0, emptyChannelIds: [CH] });
    expect(readdirSync(none.dir)).toEqual([]);
  });

  it('writes plain text and Markdown transcripts', async () => {
    const text = readFileSync((await exportTo('txt')).file, 'utf8');
    expect(text).toContain('] Alice\nhello <b>world</b>\n📎 a.txt https://cdn.discordapp.com/a.txt\nExample https://example.com\n👍 2\n\n');
    expect(text.endsWith('] Alice\n↪ reply\nyes\n\n2 messages\n')).toBe(true);
    const md = readFileSync((await exportTo('md')).file, 'utf8');
    expect(md.match(/^## /gm)).toHaveLength(1);
    expect(md).toContain('hello <b>world</b>  \n');
    expect(md).toContain('- 📎 [a.txt](<https://cdn.discordapp.com/a.txt>)');
    expect(md).toContain('- [Example](<https://example.com>)');
  });

  it('writes CSV a spreadsheet reads as text: quoted cells, no formulas, a byte-order mark', async () => {
    new Archive(db).ingestMessages([rawMessage(CH, T0 + 2 * MS_PER_MIN, '=HYPERLINK("https://evil.example","x")\nsecond, line')], ARRIVAL.gateway);
    const csv = readFileSync((await exportTo('csv')).file, 'utf8');
    expect(csv.startsWith('﻿"id","timestamp","edited","authorId","author","content","attachments","reactions","replyToId"\r\n')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"",""x"")\nsecond, line"`);
    expect(csv).toContain(`"yes","","","${snowflakeFromMs(T0)}"\r\n`);
    expect(csv.split('\r\n')).toHaveLength(5);
  });
});
