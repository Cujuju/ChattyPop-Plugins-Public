// The jobs table (JOBS_TABLE): queue and results.
import { type AttachmentNote, VOICE_MESSAGE_FLAG } from '@plugin-sdk/shared';
import { type PluginDb, type ArchivePayloadReader } from '@plugin-sdk/core';
import { TRANSCRIPT_NOTE } from '../shared';
import type { TranscriptState } from '../shared/types';
import { JOBS_TABLE } from './schema';
import type { TranscriptResult } from './whisper';

export const PRIORITY = { automatic: 0, requested: 1 } as const;

export interface TranscriptJob {
  /** Its place in the queue's history: the transcript's order among its message's derived texts. */
  seq: number;
  attachmentId: string;
  messageId: string;
  channelId: string;
  url: string;
  sha256: string | null;
  filename: string;
  requestedAt: number;
}

/** Jobs a quit or turning off interrupted start over; `keep`: attachments whose audio main is still downloading. */
export function resetInterrupted(db: PluginDb, keep: readonly string[] = []): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'queued' WHERE state IN ('fetching', 'running') AND attachment_id NOT IN (SELECT value FROM json_each(?))`).run(JSON.stringify(keep));
}

/**
 * Queues an attachment. A failed one is queued again; a queued one only gains priority; one in progress or done is
 * left alone. Returns whether anything changed.
 */
export function enqueue(db: PluginDb, attachmentId: string, priority: number, now: number): boolean {
  const info = db
    .prepare(
      `INSERT INTO ${JOBS_TABLE} (attachment_id, message_id, state, priority, requested_at)
       SELECT id, message_id, 'queued', ?, ? FROM archive_all_attachments WHERE id = ?
       ON CONFLICT(attachment_id) DO UPDATE SET state = 'queued', priority = MAX(priority, excluded.priority), error = NULL,
         requested_at = CASE WHEN state = 'failed' THEN excluded.requested_at ELSE requested_at END
       WHERE state = 'failed' OR (state = 'queued' AND priority < excluded.priority)`,
    )
    .run(priority, now, attachmentId);
  return info.changes > 0;
}

/** Owner requests first, then oldest request first. */
export function nextJob(db: PluginDb): TranscriptJob | undefined {
  return db
    .prepare(
      `SELECT t.seq, t.attachment_id AS attachmentId, t.message_id AS messageId, a.channel_id AS channelId, a.url, a.sha256, a.filename, t.requested_at AS requestedAt
       FROM ${JOBS_TABLE} t JOIN archive_all_attachments a ON a.id = t.attachment_id
       WHERE t.state = 'queued' ORDER BY t.priority DESC, t.requested_at LIMIT 1`,
    )
    .get() as TranscriptJob | undefined;
}

export function setState(db: PluginDb, attachmentId: string, state: TranscriptState): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = ? WHERE attachment_id = ?`).run(state, attachmentId);
}

export function finish(db: PluginDb, attachmentId: string, r: TranscriptResult, model: string, now: number): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'done', text = ?, segments = ?, language = ?, model = ?, error = NULL, done_at = ? WHERE attachment_id = ?`).run(
    r.text,
    JSON.stringify(r.segments),
    r.language,
    model,
    now,
    attachmentId,
  );
}

export function fail(db: PluginDb, attachmentId: string, error: string): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'failed', error = ? WHERE attachment_id = ?`).run(error, attachmentId);
}

export function jobState(db: PluginDb, attachmentId: string): TranscriptState | undefined {
  return db.prepare(`SELECT state FROM ${JOBS_TABLE} WHERE attachment_id = ?`).pluck().get(attachmentId) as TranscriptState | undefined;
}

export function messageOf(db: PluginDb, attachmentId: string): string | undefined {
  return (db.prepare(`SELECT message_id AS id FROM ${JOBS_TABLE} WHERE attachment_id = ?`).get(attachmentId) as { id: string } | undefined)?.id;
}

export interface AudioAttachment {
  messageId: string;
  ts: number;
  /** Discord flagged its message as a voice message. */
  voice: boolean;
  /** The attachment's download: pending | stored | failed. */
  status: string;
  /** Its transcript's state; null when never queued. */
  transcript: TranscriptState | null;
}

const AUDIO_SQL = `SELECT a.message_id AS messageId, m.ts, a.status, t.state AS transcript
                   FROM archive_all_attachments a JOIN archive_all_messages m ON m.id = a.message_id LEFT JOIN ${JOBS_TABLE} t ON t.attachment_id = a.id
                   WHERE a.content_type LIKE 'audio/%'`;
type AudioRow = Omit<AudioAttachment, 'voice'>;
const toAudio = (r: AudioRow, flags: number | null): AudioAttachment => ({ ...r, voice: ((flags ?? 0) & VOICE_MESSAGE_FLAG) !== 0 });

/** An audio attachment; undefined when not audio. */
export function audioAttachment(db: PluginDb, payloads: ArchivePayloadReader, attachmentId: string): AudioAttachment | undefined {
  const row = db.prepare(`${AUDIO_SQL} AND a.id = ?`).get(attachmentId) as AudioRow | undefined;
  return row && toAudio(row, payloads([row.messageId]).get(row.messageId)?.flags ?? null);
}

/** A message's audio attachments. */
export function audioOfMessage(db: PluginDb, payloads: ArchivePayloadReader, messageId: string): AudioAttachment[] {
  const rows = db.prepare(`${AUDIO_SQL} AND a.message_id = ?`).all(messageId) as AudioRow[];
  const flags = rows.length ? payloads([messageId]).get(messageId)?.flags ?? null : null;
  return rows.map((row) => toAudio(row, flags));
}

const TRANSCRIPT_STATE_TEXT = { queued: 'Waiting to transcribe…', fetching: 'Downloading the audio again…', running: 'Transcribing…' } as const;

/** Each transcript of these attachments as a note: the text, or where it has got to. */
export function transcriptNotes(db: PluginDb, attachmentIds: string[]): Map<string, Omit<AttachmentNote, 'pluginId'>> {
  const rows = db
    .prepare(`SELECT attachment_id AS id, state, text, language, error FROM ${JOBS_TABLE} WHERE attachment_id IN (${attachmentIds.map(() => '?').join(',')})`)
    .all(...attachmentIds) as { id: string; state: TranscriptState; text: string | null; language: string | null; error: string | null }[];
  const body = (t: (typeof rows)[number]): string => {
    if (t.state === 'done') return t.text || '(no speech found)';
    if (t.state === 'failed') return `Transcription failed: ${t.error ?? 'unknown error'}`;
    return TRANSCRIPT_STATE_TEXT[t.state];
  };
  return new Map(rows.map((t) => [t.id, { kind: TRANSCRIPT_NOTE, state: t.state, label: t.language ? `transcript · ${t.language}` : 'transcript', text: body(t) }]));
}
