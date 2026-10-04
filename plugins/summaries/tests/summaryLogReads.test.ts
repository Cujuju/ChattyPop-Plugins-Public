// Summaries' log read over the archive views: reply flags are decoded only when the filler filter needs them.
import { describe, expect, it, vi } from 'vitest';
import { compressRawJson } from '@core/db';
import { archiveReplyFlags } from '@core/plugins/archiveReplies';
import { tempDb } from '@chattypop/host-testing';
import { seedArchiveViews } from '@chattypop/host-testing/archiveViewsFixture';
import { readLog } from '../core/summaryLog';

describe('archive read plans and view compatibility', () => {
  it('reads reply flags for the log only when filtering, with the same lines either way', () => {
    const db = tempDb();
    seedArchiveViews(db);
    db.prepare("UPDATE messages SET author_id = 'u2', raw_json = ? WHERE id = 'm-ref-channel'")
      .run(compressRawJson(JSON.stringify({ type: 19, message_reference: { message_id: 'm-open' } })));
    const reader = vi.fn((ids: readonly string[]) => archiveReplyFlags(db, ids));
    const unfiltered = readLog(db, reader, ['c-open'], 0, 10, 'overall', false);
    expect(reader).not.toHaveBeenCalled();
    const filtered = readLog(db, reader, ['c-open'], 0, 10, 'overall', true);
    expect(reader).toHaveBeenCalledOnce();
    expect(filtered.map((line) => line.plain)).toEqual(unfiltered.map((line) => line.plain));
  });
  it('reads what a message links to after its own text, and a bare shared link counts', () => {
    const db = tempDb();
    seedArchiveViews(db);
    db.prepare("INSERT INTO messages (id, channel_id, author_id, ts, content) VALUES ('m-tweet', 'c-open', 'u1', 5, '')").run();
    db.prepare("INSERT INTO links (id, url, platform, first_message_id, first_channel_id, first_author_id, first_ts) VALUES (9, 'https://x.com/i/status/9', 'x', 'm-tweet', 'c-open', 'u1', 5)").run();
    db.prepare("INSERT INTO message_links (message_id, link_id) VALUES ('m-tweet', 9)").run();
    db.prepare("INSERT INTO link_texts (url, source, text) VALUES ('https://x.com/i/status/9', 'links', 'MacBook Pro is lighter')").run();
    const line = readLog(db, () => new Map(), ['c-open'], 0, 10, 'overall', true).find((l) => l.citation.messageId === 'm-tweet');
    expect(line?.plain).toMatch(/: ↳ links to: MacBook Pro is lighter$/);
    expect(line?.filler).toBe(false);
  });
});
