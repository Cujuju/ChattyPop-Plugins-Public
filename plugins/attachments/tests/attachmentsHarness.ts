import { onTestFinished } from 'vitest';
import { testPlugin, type SeedMessage, type TestOptions } from '@plugin-sdk/core/testing';
import { MS_PER_S } from '@plugin-sdk/shared';
import attachmentsCore from '../core';
import type { plugin } from '../shared';

export const BASE_TS = Date.UTC(2026, 0, 1);
export const at = (n: number): number => BASE_TS + n * MS_PER_S;
export const SHARED_SHA = 'a'.repeat(64);

export const files = [
  { id: 'a1', channelId: '200000000000000001', authorId: 'alice', ts: at(1), filename: 'photo.png', contentType: 'image/png', size: 300, status: 'stored', bytes: 100, sha: SHARED_SHA },
  { id: 'a2', channelId: '200000000000000001', authorId: 'bob', ts: at(2), filename: 'clip.mp4', contentType: 'video/mp4', size: 5000, status: 'stored', bytes: 2000, sha: 'b'.repeat(64) },
  { id: 'a3', channelId: '200000000000000002', authorId: 'carol', ts: at(3), filename: 'song.mp3', contentType: 'audio/mpeg', size: 400, status: 'evicted', bytes: null, sha: null },
  { id: 'a4', channelId: '300000000000000001', authorId: 'bob', ts: at(4), filename: '100%_budget.pdf', contentType: 'application/pdf', size: 150, status: 'pending', bytes: null, sha: null },
  { id: 'a5', channelId: '200000000000000002', authorId: 'bob', ts: at(5), filename: 'SPOILER_photo.png', contentType: 'image/png', size: 300, status: 'stored', bytes: 100, sha: SHARED_SHA },
  { id: 'a6', channelId: '200000000000000003', authorId: 'alice', ts: at(6), filename: 'private.mp4', contentType: 'video/mp4', size: 1000, status: 'stored', bytes: 1000, sha: 'c'.repeat(64) },
  { id: 'a7', channelId: '200000000000000001', authorId: 'alice', ts: at(7), filename: 'small.jpg', contentType: 'image/jpeg', size: 90, status: 'stored', bytes: 60, sha: 'd'.repeat(64) },
  { id: 'a8', channelId: '200000000000000001', authorId: 'alice', ts: at(8), filename: 'draft_budget.pdf', contentType: 'application/pdf', size: 150, status: 'failed', bytes: null, sha: null },
] as const;

export function seedMessage(file: { id: string; channelId: string; ts: number; filename: string; contentType: string | null; size: number; authorId?: string }): SeedMessage {
  return { channelId: file.channelId, ts: file.ts, authorId: file.authorId ?? 'alice', content: 'shared file',
    extra: { attachments: [{ id: file.id, filename: file.filename, content_type: file.contentType, size: file.size,
      url: `https://cdn.discordapp.com/attachments/${file.channelId}/${file.id}/${file.filename}`, width: 640, height: 480,
      flags: 0 }] } };
}

export function start(options: TestOptions<typeof plugin> = {}) {
  const t = testPlugin(attachmentsCore, options);
  onTestFinished(() => t.dispose());
  return t;
}

/** Files arrive through real message ingestion; stored-file metadata is then set as a download would set it. */
export function fixture() {
  const t = start({ archive: {
    guilds: [{ id: '100000000000000001', name: 'North' }, { id: '100000000000000002', name: 'South', hidden: true }],
    channels: [{ id: '200000000000000001', name: 'general', guildId: '100000000000000001' }, { id: '200000000000000002', name: 'other', guildId: '100000000000000001', hidden: true },
      { id: '300000000000000001', name: 'thread', guildId: '100000000000000001', parentId: '200000000000000001' }, { id: '200000000000000003', name: 'secret', guildId: '100000000000000002' }],
    messages: files.map(seedMessage),
  } });
  const store = t.db.prepare('UPDATE attachments SET status = ?, sha256 = ?, stored_bytes = ?, stored_ext = ?, compressed_at = ?, removed_at = ? WHERE id = ?');
  for (const f of files) store.run(f.status, f.sha, f.bytes, f.id === 'a7' ? 'webp' : null, f.id === 'a7' ? at(9) : null, f.id === 'a2' ? at(9) : null, f.id);
  return { t, client: t.client('renderer') };
}

export const ids = (items: readonly { id: string }[]): string[] => items.map((i) => i.id);
