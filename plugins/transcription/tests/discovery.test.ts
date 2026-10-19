import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import { archiveAsync } from '@core/plugins/archiveAsync';
import { archiveRead } from '@core/plugins/pluginDb';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { compressRawJson, setSetting } from '@core/db';
import { messageParts } from '@core/messageParts';
import { closeArchiveReads } from '@core/reads/archiveReads';
import { seedArchive, tempDb } from '@chattypop/host-testing';
import { MediaDiscovery } from '../core/discovery';
import { mediaSources } from '../core/sources';
import { JOBS_TABLE, TRANSCRIPTION_MIGRATIONS } from '../core/schema';
import { migratePlugin } from '@core/plugins/api';

/** Matches a background discovery batch; large compressed payloads expose synchronous source decoding. */
const BATCH_ROWS = 16;
const PAYLOAD_CHARS = 16_384;

describe('background media discovery', () => {
  it('retries pending ids when privacy invalidates their shared helper', async () => {
    let fail!: (error: Error) => void;
    const first = new Promise<[]>((_resolve, reject) => { fail = reject; });
    const read = vi.fn<(_: string[]) => Promise<[]>>().mockImplementationOnce(() => first).mockResolvedValue([]);
    const apply = vi.fn();
    const discovery = new MediaDiscovery(new AbortController().signal, read, apply, () => true, () => undefined);
    discovery.shown('pending');
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    discovery.invalidate(); fail(new Error('Archive visibility changed'));
    await vi.waitFor(() => expect(discovery.busy).toBe(false));
    expect(read).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith('pending', []);
  });
  it('records ingest ids without reading, bounds helper batches, and discards cancelled answers', async () => {
    const stop = new AbortController();
    const read = vi.fn(async (_ids: string[]) => []);
    const apply = vi.fn(), settled = vi.fn();
    const discovery = new MediaDiscovery(stop.signal, read, apply, () => true, settled);
    for (let i = 0; i < BATCH_ROWS * 3; i++) discovery.shown(String(i));
    expect(read).not.toHaveBeenCalled();
    expect(discovery.due('0')).toBe(true);
    await vi.waitFor(() => expect(discovery.busy).toBe(false));
    expect(read.mock.calls.every(([ids]) => ids.length <= BATCH_ROWS)).toBe(true);
    expect(apply).toHaveBeenCalledTimes(BATCH_ROWS * 3);
    let answer!: (value: []) => void;
    const held = new MediaDiscovery(stop.signal, () => new Promise((resolve) => { answer = resolve; }), apply, () => true, settled);
    held.shown('late');
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    stop.abort(); answer([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(apply).toHaveBeenCalledTimes(BATCH_ROWS * 3);
  });

  it('reads selected source payloads and states off Core, retaining hidden background scope', async () => {
    const db = tempDb(); seedArchive(db, [{ id: 'hidden' }]);
    migratePlugin(db, 'transcription', TRANSCRIPTION_MIGRATIONS);
    db.prepare("UPDATE channels SET hide_in_privacy = 1 WHERE id = 'hidden'").run();
    setSetting(db, 'privacyMode', true);
    const ids = Array.from({ length: BATCH_ROWS }, (_, i) => String(i));
    const put = db.prepare("INSERT INTO messages (id, channel_id, author_id, ts, content, raw_json) VALUES (?, 'hidden', 'u', 1, '', ?)");
    const payload = compressRawJson(JSON.stringify({ content: 'x'.repeat(PAYLOAD_CHARS), embeds: [{ type: 'rich', video: { proxy_url: 'https://example.com/video.mp4' } }] }));
    db.transaction(() => { for (const id of ids) put.run(id, payload); })();
    db.prepare("INSERT INTO attachments (id, message_id, channel_id, filename, content_type, url) VALUES ('orphan', 'gone', 'hidden', 'clip.mp4', 'video/mp4', 'https://example.com/orphan.mp4')").run();
    db.prepare(`INSERT INTO ${JOBS_TABLE} (message_id, part_key, kind, url, state, priority, requested_at) VALUES ('gone', 'attachment:orphan', 'video', 'https://example.com/orphan.mp4', 'done', 0, 1)`).run();
    const host = archiveAsync(() => db, () => true);
    const archive = { read: archiveRead(() => db), parts: async (ids: readonly string[], opts?: Parameters<ReturnType<typeof archiveRead>>[2]) => (await host.parts(ids, opts)).parts, payloads: host.payloads };
    try {
      const before = performance.now();
      messageParts(db, ids); archivePayloads(db, ids);
      const legacyCoreMs = performance.now() - before;
      const prepare = vi.spyOn(db, 'prepare');
      const start = performance.now();
      const pending = mediaSources(archive, ids);
      const dispatchMs = performance.now() - start;
      try {
        const sources = await pending;
        expect(sources).toHaveLength(BATCH_ROWS);
        expect(sources.every((s) => s.auto === 'embedVideo' && s.download === null && s.transcript === null && s.ts === 1)).toBe(true);
        expect(await mediaSources(archive, ['gone'])).toMatchObject([{ messageId: 'gone', partKey: 'attachment:orphan', ts: 0, transcript: 'done' }]);
        expect(prepare).not.toHaveBeenCalled();
        process.stdout.write(JSON.stringify({ rows: BATCH_ROWS, legacyCoreMs, dispatchMs }) + '\n');
      } finally { prepare.mockRestore(); }
    } finally { await closeArchiveReads(db); db.close(); }
  });
});
