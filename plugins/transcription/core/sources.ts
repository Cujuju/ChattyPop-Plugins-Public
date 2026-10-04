// What can be transcribed: each message's audio and video parts (archive.parts), with what automatic transcription needs.
import { VOICE_MESSAGE_FLAG } from '@plugin-sdk/shared';
import type { ArchivePayloadReader, MessagePart, PluginDb } from '@plugin-sdk/core';
import type { AutoKind, TranscriptState } from '../shared/types';
import { jobStates, sentAt, type JobSource } from './store';

/** The archive reads transcription makes (the context's archive.payloads and archive.parts.of). */
export interface TranscriptionArchive {
  payloads: ArchivePayloadReader;
  parts(messageIds: readonly string[]): Map<string, MessagePart[]>;
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
export function mediaSources(db: PluginDb, archive: TranscriptionArchive, messageIds: readonly string[]): MediaSource[] {
  if (!messageIds.length) return [];
  const parts = archive.parts(messageIds);
  const ids = messageIds.filter((id) => parts.get(id)?.some((p) => p.kind === 'audio' || p.kind === 'video'));
  if (!ids.length) return [];
  const sent = sentAt(db, ids);
  const payloads = archive.payloads(ids);
  const states = jobStates(db, ids);
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
