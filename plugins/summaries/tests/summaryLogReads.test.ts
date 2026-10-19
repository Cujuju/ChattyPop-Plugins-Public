// Summaries' log read over the archive views: reply flags are decoded only when the filler filter needs them.
import { describe, expect, it, vi } from 'vitest';
import { compressRawJson } from '@core/db';
import type { ArchiveRead } from '@plugin-sdk/core';
import { archiveRead } from '@core/plugins/pluginDb';
import { tempDb } from '@chattypop/host-testing';
import { seedArchiveViews } from '@chattypop/host-testing/archiveViewsFixture';
import { readLog } from '../core/summaryLog';

describe('archive read plans and view compatibility', () => {
  it('decodes reply flags in the worker only when filtering, with the same lines either way', async () => {
    const db = tempDb();
    seedArchiveViews(db);
    db.prepare("UPDATE messages SET author_id = 'u2', raw_json = ? WHERE id = 'm-ref-channel'")
      .run(compressRawJson(JSON.stringify({ type: 19, message_reference: { message_id: 'm-open' } })));
    const reader = vi.fn(archiveRead(() => db));
    const unfiltered = await readLog(reader as ArchiveRead, ['c-open'], 0, 10, 'overall', false);
    expect(reader.mock.calls[0]![0]).not.toContain('json_extract');
    const filtered = await readLog(reader as ArchiveRead, ['c-open'], 0, 10, 'overall', true);
    expect(reader.mock.calls[1]![0]).toContain('json_extract');
    expect(filtered.map((line) => line.plain)).toEqual(unfiltered.map((line) => line.plain));
  });
  it('reads what a message links to after its own text, and a bare shared link counts', async () => {
    const db = tempDb();
    seedArchiveViews(db);
    db.prepare("INSERT INTO messages (id, channel_id, author_id, ts, content) VALUES ('m-tweet', 'c-open', 'u1', 5, '')").run();
    db.prepare("INSERT INTO links (id, url, platform, first_message_id, first_channel_id, first_author_id, first_ts) VALUES (9, 'https://x.com/i/status/9', 'x', 'm-tweet', 'c-open', 'u1', 5)").run();
    db.prepare("INSERT INTO message_links (message_id, link_id) VALUES ('m-tweet', 9)").run();
    db.prepare("INSERT INTO link_texts (url, source, text) VALUES ('https://x.com/i/status/9', 'links', 'MacBook Pro is lighter')").run();
    const line = (await readLog(archiveRead(() => db), ['c-open'], 0, 10, 'overall', true)).find((l) => l.citation.messageId === 'm-tweet');
    expect(line?.plain).toMatch(/: ↳ links to: MacBook Pro is lighter$/);
    expect(line?.filler).toBe(false);
  });
});
