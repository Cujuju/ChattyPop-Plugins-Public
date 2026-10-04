// The jobs table (JOBS_TABLE): queue and results, one job per audio or video part of a message.
import type { MediaPartKind, PluginDb, PluginNote } from '@plugin-sdk/core';
import { TRANSCRIPT_NOTE } from '../shared';
import type { TranscriptState } from '../shared/types';
import { JOBS_TABLE } from './schema';
import type { TranscriptResult } from './whisper';

export const PRIORITY = { automatic: 0, requested: 1 } as const;

/** What a job transcribes: a message's audio or video part (archive.parts). */
export interface JobSource {
  messageId: string;
  partKey: string;
  kind: Extract<MediaPartKind, 'audio' | 'video'>;
  /** Set for an attachment: its file may be in the store, and main refreshes its URL. */
  attachmentId: string | null;
  url: string;
}

export interface TranscriptJob {
  /** Its place in the queue's history: the transcript's order among its message's derived texts. */
  seq: number;
  messageId: string;
  channelId: string;
  partKey: string;
  attachmentId: string | null;
  url: string;
  /** An attachment's stored file; null otherwise and until stored. */
  sha256: string | null;
  filename: string | null;
  requestedAt: number;
}

/** Jobs a quit or turning off interrupted start over; `keep`: jobs whose media main is still downloading. */
export function resetInterrupted(db: PluginDb, keep: readonly number[] = []): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'queued' WHERE state IN ('fetching', 'running') AND seq NOT IN (SELECT value FROM json_each(?))`).run(JSON.stringify(keep));
}

/**
 * Queues a part. A failed one is queued again; a queued one only gains priority; one in progress or done is left alone.
 * Returns whether anything changed.
 */
export function enqueue(db: PluginDb, s: JobSource, priority: number, now: number): boolean {
  const info = db
    .prepare(
      `INSERT INTO ${JOBS_TABLE} (message_id, part_key, kind, attachment_id, url, state, priority, requested_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
       ON CONFLICT(message_id, part_key) DO UPDATE SET state = 'queued', priority = MAX(priority, excluded.priority), error = NULL,
         requested_at = CASE WHEN state = 'failed' THEN excluded.requested_at ELSE requested_at END
       WHERE state = 'failed' OR (state = 'queued' AND priority < excluded.priority)`,
    )
    .run(s.messageId, s.partKey, s.kind, s.attachmentId, s.url, priority, now);
  return info.changes > 0;
}

/** Owner requests first, then oldest request first. An attachment's URL is the archive's, which main keeps fresh. */
export function nextJob(db: PluginDb): TranscriptJob | undefined {
  return db
    .prepare(
      `SELECT t.seq, t.message_id AS messageId, m.channel_id AS channelId, t.part_key AS partKey, t.attachment_id AS attachmentId,
         COALESCE(a.url, t.url) AS url, a.sha256, a.filename, t.requested_at AS requestedAt
       FROM ${JOBS_TABLE} t JOIN archive_all_messages m ON m.id = t.message_id LEFT JOIN archive_all_attachments a ON a.id = t.attachment_id
       WHERE t.state = 'queued' AND COALESCE(a.url, t.url) IS NOT NULL ORDER BY t.priority DESC, t.requested_at LIMIT 1`,
    )
    .get() as TranscriptJob | undefined;
}

export function setState(db: PluginDb, seq: number, state: TranscriptState): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = ? WHERE seq = ?`).run(state, seq);
}

export function finish(db: PluginDb, seq: number, r: TranscriptResult, model: string, now: number): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'done', text = ?, segments = ?, language = ?, model = ?, error = NULL, done_at = ? WHERE seq = ?`).run(
    r.text,
    JSON.stringify(r.segments),
    r.language,
    model,
    now,
    seq,
  );
}

export function fail(db: PluginDb, seq: number, error: string): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'failed', error = ? WHERE seq = ?`).run(error, seq);
}

/** A job's message and state. */
export function jobOf(db: PluginDb, seq: number): { messageId: string; state: TranscriptState } | undefined {
  return db.prepare(`SELECT message_id AS messageId, state FROM ${JOBS_TABLE} WHERE seq = ?`).get(seq) as { messageId: string; state: TranscriptState } | undefined;
}

/** Each message's transcript states, by part key. */
export function jobStates(db: PluginDb, messageIds: readonly string[]): Map<string, Map<string, TranscriptState>> {
  const rows = db
    .prepare(`SELECT message_id AS messageId, part_key AS partKey, state FROM ${JOBS_TABLE} WHERE message_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(messageIds)) as { messageId: string; partKey: string; state: TranscriptState }[];
  const out = new Map<string, Map<string, TranscriptState>>();
  for (const r of rows) out.set(r.messageId, (out.get(r.messageId) ?? new Map<string, TranscriptState>()).set(r.partKey, r.state));
  return out;
}

/** When each of these messages was sent. */
export function sentAt(db: PluginDb, messageIds: readonly string[]): Map<string, number> {
  const rows = db.prepare('SELECT id, ts FROM archive_all_messages WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(messageIds)) as { id: string; ts: number }[];
  return new Map(rows.map((m) => [m.id, m.ts]));
}

/** The message an attachment belongs to. */
/** Each done attachment transcript's derived text key (its attachment id) → its part key: tags texts stored before parts existed. */
export function transcriptParts(db: PluginDb): Map<string, string> {
  const rows = db.prepare(`SELECT attachment_id AS id, part_key AS part FROM ${JOBS_TABLE} WHERE state = 'done' AND attachment_id IS NOT NULL`).all() as { id: string; part: string }[];
  return new Map(rows.map((r) => [r.id, r.part]));
}

export function attachmentMessage(db: PluginDb, attachmentId: string): string | undefined {
  return db.prepare('SELECT message_id FROM archive_all_attachments WHERE id = ?').pluck().get(attachmentId) as string | undefined;
}

/** The derived text key of a job's transcript: an attachment's id (as stored before part jobs), else its job's seq. */
export const transcriptKey = (job: Pick<TranscriptJob, 'seq' | 'attachmentId'>): string => job.attachmentId ?? `job-${job.seq}`;

const STATE_TEXT = { queued: () => 'Waiting to transcribe…', fetching: (kind: string) => `Downloading the ${kind}…`, running: () => 'Transcribing…' } as const;

/** Each transcript of these messages' parts as a note, by message then part key: the text, or where it has got to. */
export function transcriptNotes(db: PluginDb, messageIds: readonly string[]): Map<string, Map<string, PluginNote>> {
  const rows = db
    .prepare(
      `SELECT message_id AS messageId, part_key AS partKey, kind, state, text, language, error FROM ${JOBS_TABLE}
       WHERE message_id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(messageIds)) as { messageId: string; partKey: string; kind: string; state: TranscriptState; text: string | null; language: string | null; error: string | null }[];
  const body = (t: (typeof rows)[number]): string => {
    if (t.state === 'done') return t.text || '(no speech found)';
    if (t.state === 'failed') return `Transcription failed: ${t.error ?? 'unknown error'}`;
    return STATE_TEXT[t.state](t.kind);
  };
  const out = new Map<string, Map<string, PluginNote>>();
  for (const t of rows) {
    const label = t.language ? `${t.kind} transcription · ${t.language}` : `${t.kind} transcription`;
    out.set(t.messageId, (out.get(t.messageId) ?? new Map<string, PluginNote>()).set(t.partKey, { kind: TRANSCRIPT_NOTE, state: t.state, label, text: body(t) }));
  }
  return out;
}
