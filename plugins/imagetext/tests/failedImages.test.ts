// The failure inspector lists each visible image once, with its error, and follows retries and privacy changes.
import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import imageTextCore from '../core';
import { JOBS_TABLE } from '../core/store';
import { DEFAULT_IMAGE_TEXT_SETTINGS } from '../shared/types';

function fixture(privacyMode = false) {
  const t = testPlugin(imageTextCore, {
    archive: { channels: [{ id: 'visible' }, { id: 'private', hidden: true }], privacyMode },
    preferences: { settings: { ...DEFAULT_IMAGE_TEXT_SETTINGS, autoAttachments: false, autoEmbeds: false, autoLinks: false, engine: 'vision' } },
  });
  onTestFinished(() => t.dispose());
  const [visible, hidden] = t.archive.arrive([
    { channelId: 'visible', content: 'two images', extra: { attachments: [{ id: 'a1', filename: 'chart.png', content_type: 'image/png', size: 10, url: 'https://cdn.discordapp.com/chart.png' }] } },
    { channelId: 'private', content: 'private image' },
  ]);
  const insert = t.db.prepare(`INSERT INTO ${JOBS_TABLE} (seq, message_id, channel_id, image_key, url, attachment_id, state, priority, requested_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`);
  insert.run(1, visible!, 'visible', 'attachment:a1', 'https://cdn.discordapp.com/chart.png', 'a1', 'failed', 10, 'OCR timed out');
  insert.run(2, visible!, 'visible', 'embed:1', 'https://media.discordapp.net/preview.png', null, 'failed', 20, 'Image download failed');
  insert.run(3, hidden!, 'private', 'link:1', 'https://pbs.twimg.com/media/private.png', null, 'failed', 20, 'Private failure');
  insert.run(4, visible!, 'visible', 'embed:2', 'https://media.discordapp.net/done.png', null, 'done', 30, null);
  insert.run(5, visible!, 'visible', 'embed:3', 'https://media.discordapp.net/queued.png', null, 'queued', 30, null);
  insert.run(6, 'missing', 'visible', 'embed:4', 'https://media.discordapp.net/missing.png', null, 'failed', 40, 'Source gone');
  return { t, visible, hidden };
}

describe('failed image readings', () => {
  it('lists failures newest first with stable ties and source metadata; excludes other states and missing sources', async () => {
    const { t, visible, hidden } = fixture();
    expect(await t.client('renderer').failedImages()).toEqual([
      { seq: 3, messageId: hidden, channelId: 'private', imageKey: 'link:1', url: 'https://pbs.twimg.com/media/private.png', filename: null, sha256: null, storedExt: null, error: 'Private failure', requestedAt: 20 },
      { seq: 2, messageId: visible, channelId: 'visible', imageKey: 'embed:1', url: 'https://media.discordapp.net/preview.png', filename: null, sha256: null, storedExt: null, error: 'Image download failed', requestedAt: 20 },
      { seq: 1, messageId: visible, channelId: 'visible', imageKey: 'attachment:a1', url: 'https://cdn.discordapp.com/chart.png', filename: 'chart.png', sha256: null, storedExt: null, error: 'OCR timed out', requestedAt: 10 },
    ]);
    expect(await t.client('phone').failedImages()).toHaveLength(3);
  });

  it('exposes the stored extension for compressed image previews', async () => {
    const { t } = fixture();
    const sha256 = 'a'.repeat(64);
    t.db.prepare("UPDATE attachments SET sha256 = ?, stored_ext = 'webp', status = 'stored' WHERE id = 'a1'").run(sha256);
    expect((await t.client('renderer').failedImages()).find((j) => j.imageKey === 'attachment:a1'))
      .toMatchObject({ filename: 'chart.png', sha256, storedExt: 'webp' });
  });

  it('follows live archive privacy and does not expose hidden messages or image URLs', async () => {
    const { t } = fixture(true);
    expect((await t.client('renderer').failedImages()).map((j) => j.seq)).toEqual([2, 1]);
    t.archive.setPrivacyMode(false);
    expect(await t.client('renderer').failedImages()).toHaveLength(3);
    t.archive.setChannel('visible', { hidden: true });
    t.archive.setPrivacyMode(true);
    expect(await t.client('renderer').failedImages()).toEqual([]);
  });

  it('is empty once failed jobs are retried', async () => {
    const { t } = fixture();
    await t.client('renderer').retryFailed();
    expect(await t.client('renderer').failedImages()).toEqual([]);
  });
});
