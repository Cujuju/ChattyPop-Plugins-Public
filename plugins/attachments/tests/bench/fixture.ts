import type { PluginDb } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';

export const CHANNEL = 'benchmark-channel';
const AUTHORS = 30; // Small-community author cardinality matches the analytics fixture.
const DAYS = 390; // Includes seasonal time changes and more than one calendar year.
const HASHES = 4_000; // Repeated hashes exercise cross-day disk-byte deduplication.
const ATTACHMENT_PERIOD = 5; // Two of five messages carry files.
const ATTACHMENT_MESSAGES = 2;
const LINK_PERIOD = 25; // Four of twenty-five messages share links.
const LINK_MESSAGES = 4;
const LINKS = 4_000; // Repeated URLs exercise unique link counts.
const START = Date.UTC(2025, 0, 1);
const STORED_PERIOD = 4; // One quarter of files are no longer on disk.
const STORED_BYTES = 8192; // Fixed byte size makes expected deduplication independently calculable.

export function seed(db: PluginDb, rows: number) {
  const message = db.prepare('INSERT INTO messages(id, channel_id, author_id, ts, content) VALUES (?, ?, ?, ?, ?)');
  const attachment = db.prepare(`INSERT INTO attachments(id, message_id, channel_id, ts, filename, content_type, url, size, status, sha256, stored_bytes)
    VALUES (?, ?, ?, ?, 'fixture.png', 'image/png', 'https://example.test/fixture.png', ?, ?, ?, ?)`);
  const link = db.prepare(`INSERT OR IGNORE INTO links(id, url, platform, first_message_id, first_channel_id, first_author_id, first_ts)
    VALUES (?, ?, 'web', ?, ?, ?, ?)`);
  const share = db.prepare('INSERT INTO message_links(message_id, link_id) VALUES (?, ?)');
  let attachments = 0;
  let shares = 0;
  db.transaction(() => {
    for (let n = 0; n < rows; n++) {
      const id = String(n + 1);
      const author = `author-${n % AUTHORS}`;
      const ts = START + Math.floor((rows - n - 1) * DAYS * MS_PER_DAY / rows);
      message.run(id, CHANNEL, author, ts, 'Synthetic benchmark message.');
      if (n % ATTACHMENT_PERIOD < ATTACHMENT_MESSAGES) {
        const stored = n % STORED_PERIOD !== 0;
        attachment.run(`file-${id}`, id, CHANNEL, ts, STORED_BYTES, stored ? 'stored' : 'evicted',
          (n % HASHES).toString(16).padStart(64, '0'), stored ? STORED_BYTES : null);
        attachments++;
      }
      if (n % LINK_PERIOD < LINK_MESSAGES) {
        const linkId = n % LINKS + 1;
        link.run(linkId, `https://example.test/item/${linkId}`, id, CHANNEL, author, ts);
        share.run(id, linkId);
        shares++;
      }
    }
  })();
  return { messages: rows, attachments, linkShares: shares, days: DAYS, authors: AUTHORS, ingestion: 'newest first' };
}
