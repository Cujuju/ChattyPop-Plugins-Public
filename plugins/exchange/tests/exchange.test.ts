import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { snowflakeFromMs } from '@shared/discord';
import { MS_PER_MIN } from '@shared/units';
import { Archive } from '@core/archive';
import type { Db } from '@core/db';
import { exportChannels, importDceFiles } from '../core/exchange';
import { messagePage } from '@core/queries/messages';
import { rawMessage, seedArchive, tempDb, tempDir } from '@chattypop/host-testing';
import { attachmentStored } from '@core/mediaQueue';
import { storedAttachmentPath } from '@core/attachmentRetention';
import type { DceExport, DceMessage } from '../core/dce';
import { ARRIVAL } from '@core/arrival';

const CH = '200000000000000001';
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

const exportTo = (format: 'json' | 'html') => {
  const dir = tempDir();
  const r = exportChannels(db, tempDir(), { channelIds: [CH], format, includeMedia: false, dir });
  return { r, dir, file: join(dir, readdirSync(dir)[0]!) };
};

describe('archive exchange (DiscordChatExporter format)', () => {
  it('round-trips a channel through a DCE JSON export', () => {
    const { r, file } = exportTo('json');
    expect(r).toEqual({ channelIds: [CH], messages: 2, skippedFiles: [] });

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

  it('writes a standalone HTML page with message text escaped', () => {
    const html = readFileSync(exportTo('html').file, 'utf8');
    expect(html).toContain('hello &lt;b&gt;world&lt;/b&gt;');
    expect(html).toContain(`href="#m${snowflakeFromMs(T0)}"`);
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

  it('never lets an imported or archived payload run script or load code in the HTML export', () => {
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
    const dir = tempDir();
    exportChannels(target, tempDir(), { channelIds: ['200000000000000009'], format: 'html', includeMedia: false, dir });
    const html = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8');
    // Hostile text may appear escaped, as text; never as an element, attribute or link.
    expect(html).not.toMatch(/<script|<img[^>]*onerror|(?:href|src)="\s*javascript:|style="[^"]*url\(/i);
    expect(html).toContain("script-src 'none'");
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

  it('gives channels with the same names their own export file and media folder', () => {
    const OTHER = '200000000000000002';
    const a = new Archive(db);
    a.upsertChannels('g1', [{ id: OTHER, name: 'general', type: 0 }]);
    a.setOptIn(OTHER, true);
    a.ingestMessages([rawMessage(OTHER, T0 + 5, 'the other general')], ARRIVAL.gateway);
    const dir = tempDir();
    expect(exportChannels(db, tempDir(), { channelIds: [CH, OTHER], format: 'json', includeMedia: false, dir }).channelIds).toEqual([CH, OTHER]);
    const docs = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as DceExport);
    expect(docs.map((d) => d.messages.map((m) => m.content))).toEqual(expect.arrayContaining([['hello <b>world</b>', 'yes'], ['the other general']]));
  });

  it('links copied media by URL-encoded path, so # and % in names reach the file', () => {
    db.prepare("UPDATE guilds SET name = 'Guild #1 100%'").run();
    const sha = 'c'.repeat(64);
    const attachmentsDir = tempDir();
    const src = storedAttachmentPath(attachmentsDir, sha, 'a.txt');
    mkdirSync(join(src, '..'), { recursive: true });
    writeFileSync(src, 'abc');
    attachmentStored(db, '500000000000000001', sha, 3);
    const dir = tempDir();
    exportChannels(db, attachmentsDir, { channelIds: [CH], format: 'html', includeMedia: true, dir });
    const html = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('.html'))!), 'utf8');
    const href = /<a href="([^"]+)">a\.txt<\/a>/.exec(html)![1]!;
    const target = decodeURIComponent(new URL(href, 'file:///export/').pathname).slice('/export/'.length);
    expect(existsSync(join(dir, target))).toBe(true);
  });
});
