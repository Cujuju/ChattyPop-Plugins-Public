// What can be transcribed: each message's audio and video parts (archive.parts), with what automatic transcription needs.
import { VOICE_MESSAGE_FLAG } from '@plugin-sdk/shared';
import type { ArchivePayloadReader, ArchiveRead, MessagePart } from '@plugin-sdk/core';
import type { AutoKind, TranscriptState } from '../shared/types';
import type { JobSource } from './store';
import { JOBS_TABLE } from './schema';

/** The archive reads transcription makes (the context's archive.payloads and archive.parts.of). */
export interface TranscriptionArchive {
  read: ArchiveRead;
  payloads(messageIds: readonly string[], options?: Parameters<ArchiveRead>[2]): ReturnType<ArchivePayloadReader> | Promise<ReturnType<ArchivePayloadReader>>;
  parts(messageIds: readonly string[], options?: Parameters<ArchiveRead>[2]): Map<string, MessagePart[]> | Promise<Map<string, MessagePart[]>>;
}

export interface MediaSource extends JobSource {
  /** Which automatic switch covers it. */
  auto: AutoKind;
  /** When its message was sent. */
  ts: number;
  /** An attachment's download (pending | stored | failed); null for an embed's video. */
  download: string | null;
  /** Its transcript's state; null when never queued. */
  transcript: TranscriptState | null;
}

/** The audio and video of these messages, in the order each shows them. */
export async function mediaSources(archive: TranscriptionArchive, messageIds: readonly string[], signal?: AbortSignal): Promise<MediaSource[]> {
  if (!messageIds.length) return [];
  const options = { signal, priority: 'background' as const };
  const parts = await archive.parts(messageIds, options);
  const ids = messageIds.filter((id) => parts.get(id)?.some((p) => p.kind === 'audio' || p.kind === 'video'));
  if (!ids.length) return [];
  const [payloads, rows] = await Promise.all([
    archive.payloads(ids, options),
    archive.read<{ id: string; ts: number | null; part: string | null; state: TranscriptState | null }>(
      `SELECT wanted.value AS id, m.ts, j.part_key AS part, j.state FROM json_each(?) wanted
       LEFT JOIN archive_all_messages m ON m.id = wanted.value LEFT JOIN ${JOBS_TABLE} j ON j.message_id = wanted.value`, [JSON.stringify(ids)], options),
  ]);
  signal?.throwIfAborted();
  const sent = new Map(rows.map((row) => [row.id, row.ts]));
  const states = new Map<string, Map<string, TranscriptState>>();
  for (const row of rows) if (row.part && row.state) states.set(row.id, (states.get(row.id) ?? new Map()).set(row.part, row.state));
  return ids.flatMap((messageId) => {
    const voice = ((payloads.get(messageId)?.flags ?? 0) & VOICE_MESSAGE_FLAG) !== 0;
    return (parts.get(messageId) ?? []).flatMap((p): MediaSource[] => {
      if (p.kind !== 'audio' && p.kind !== 'video') return [];
      const auto: AutoKind = p.source !== 'attachment' ? 'embedVideo' : p.kind === 'video' ? 'video' : voice ? 'voice' : 'audio';
      return [
        {
          messageId,
          partKey: p.key,
          kind: p.kind,
          attachmentId: p.attachment?.id ?? null,
          url: p.url,
          auto,
          ts: sent.get(messageId) ?? 0,
          download: p.attachment?.status ?? null,
          transcript: states.get(messageId)?.get(p.key) ?? null,
        },
      ];
    });
  });
}
