// The jobs table: one row per image of a message, its queue state and what was read.
import { pluginTable, type AttachmentNote } from '@plugin-sdk/shared';
import type { MessageImage, PluginDb } from '@plugin-sdk/core';
import { IMAGE_TEXT_NOTE, plugin } from '../shared';
import type { ImageJobState } from '../shared/types';

export const JOBS_TABLE = pluginTable(plugin, 'jobs');

/**
 * Image text's schema steps (ctx.storage.migrate); append, never edit a shipped one. `seq` orders a message's image
 * texts; `image_key` is MessageImage.key; `attachment_id` is set for an attachment (its file may be in the store).
 */
export const IMAGE_TEXT_MIGRATIONS: readonly string[] = [
  `CREATE TABLE ${JOBS_TABLE} (seq INTEGER PRIMARY KEY, message_id TEXT NOT NULL, channel_id TEXT NOT NULL, image_key TEXT NOT NULL,
     url TEXT NOT NULL, attachment_id TEXT, state TEXT NOT NULL, priority INTEGER NOT NULL, requested_at INTEGER NOT NULL,
     engine TEXT, text TEXT, error TEXT, done_at INTEGER, UNIQUE (message_id, image_key));
   CREATE INDEX ${JOBS_TABLE}_state ON ${JOBS_TABLE} (state, priority, requested_at);`,
];

export const PRIORITY = { automatic: 0, requested: 1 } as const;
/** Job states still heading for done or failed. */
export const ACTIVE_STATES: readonly ImageJobState[] = ['queued', 'fetching', 'running'];

export interface ImageJob {
  seq: number;
  messageId: string;
  channelId: string;
  imageKey: string;
  url: string;
  attachmentId: string | null;
  requestedAt: number;
}

/**
 * Queues each image of a message. `again` (the owner asked): every image is queued anew, whatever its state; otherwise
 * only images never queued. Returns whether anything changed.
 */
export function enqueue(db: PluginDb, messageId: string, channelId: string, images: readonly MessageImage[], priority: number, now: number, again: boolean): boolean {
  const insert = db.prepare(
    `INSERT INTO ${JOBS_TABLE} (message_id, channel_id, image_key, url, attachment_id, state, priority, requested_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
     ON CONFLICT (message_id, image_key) DO ${again
       ? `UPDATE SET state = 'queued', priority = MAX(priority, excluded.priority), url = excluded.url, error = NULL, requested_at = excluded.requested_at
          WHERE state NOT IN ('fetching', 'running')`
       : 'NOTHING'}`,
  );
  let changed = 0;
  for (const i of images) changed += insert.run(messageId, channelId, i.key, i.url, i.attachment?.id ?? null, priority, now).changes;
  return changed > 0;
}

/**
 * The next job to run: owner requests first, then oldest first. A job queued after `waitedSince` whose attachment the
 * store is still downloading waits for it (onAttachmentStored kicks the queue) without holding up images behind it; one
 * queued before fetches the image itself.
 */
export function nextJob(db: PluginDb, waitedSince: number): ImageJob | undefined {
  return db
    .prepare(
      `SELECT j.seq, j.message_id AS messageId, j.channel_id AS channelId, j.image_key AS imageKey, j.url, j.attachment_id AS attachmentId,
              j.requested_at AS requestedAt
       FROM ${JOBS_TABLE} j LEFT JOIN archive_all_attachments a ON a.id = j.attachment_id
       WHERE j.state = 'queued' AND (a.status IS NULL OR a.status != 'pending' OR j.requested_at < ?)
       ORDER BY j.priority DESC, j.requested_at, j.seq LIMIT 1`,
    )
    .get(waitedSince) as ImageJob | undefined;
}

export function setState(db: PluginDb, seq: number, state: ImageJobState): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = ? WHERE seq = ?`).run(state, seq);
}

export function finish(db: PluginDb, seq: number, engine: string, text: string, now: number): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'done', engine = ?, text = ?, error = NULL, done_at = ? WHERE seq = ?`).run(engine, text, now, seq);
}

export function fail(db: PluginDb, seq: number, error: string): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'failed', error = ? WHERE seq = ?`).run(error, seq);
}

export function jobOf(db: PluginDb, seq: number): { messageId: string; state: ImageJobState } | undefined {
  return db.prepare(`SELECT message_id AS messageId, state FROM ${JOBS_TABLE} WHERE seq = ?`).get(seq) as { messageId: string; state: ImageJobState } | undefined;
}

/** A job's text from its last reading; null when never read. */
export const jobText = (db: PluginDb, seq: number): string | null =>
  (db.prepare(`SELECT text FROM ${JOBS_TABLE} WHERE seq = ?`).pluck().get(seq) as string | null | undefined) ?? null;

/** Jobs a quit or turning off interrupted start over; `keep`: jobs whose image main is still downloading. */
export function resetInterrupted(db: PluginDb, keep: readonly number[] = []): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'queued' WHERE state IN ('fetching', 'running') AND seq NOT IN (SELECT value FROM json_each(?))`).run(JSON.stringify(keep));
}

/** Failed jobs queued again; returns their messages. */
export function retryFailed(db: PluginDb, now: number): string[] {
  const ids = db.prepare(`SELECT DISTINCT message_id FROM ${JOBS_TABLE} WHERE state = 'failed'`).pluck().all() as string[];
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'queued', error = NULL, requested_at = ? WHERE state = 'failed'`).run(now);
  return ids;
}

/** Whether any image of the message is still being read. */
export function messageActive(db: PluginDb, messageId: string): boolean {
  return db.prepare(`SELECT 1 FROM ${JOBS_TABLE} WHERE message_id = ? AND state IN ('queued', 'fetching', 'running') LIMIT 1`).get(messageId) !== undefined;
}

/** The message's jobs: each image queued or read, its state and text. */
export function messageJobs(db: PluginDb, messageId: string): { seq: number; imageKey: string; state: ImageJobState; text: string | null; requestedAt: number }[] {
  return db
    .prepare(`SELECT seq, image_key AS imageKey, state, text, requested_at AS requestedAt FROM ${JOBS_TABLE} WHERE message_id = ?`)
    .all(messageId) as { seq: number; imageKey: string; state: ImageJobState; text: string | null; requestedAt: number }[];
}

/** Removes jobs (images their message no longer shows). */
export function dropJobs(db: PluginDb, seqs: readonly number[]): void {
  db.prepare(`DELETE FROM ${JOBS_TABLE} WHERE seq IN (SELECT value FROM json_each(?))`).run(JSON.stringify(seqs));
}

/** Whether any job is queued. */
export const queuedJobs = (db: PluginDb): boolean => db.prepare(`SELECT 1 FROM ${JOBS_TABLE} WHERE state = 'queued' LIMIT 1`).get() !== undefined;

export function counts(db: PluginDb): Record<ImageJobState, number> {
  const out: Record<ImageJobState, number> = { queued: 0, fetching: 0, running: 0, done: 0, failed: 0 };
  for (const r of db.prepare(`SELECT state, COUNT(*) AS n FROM ${JOBS_TABLE} GROUP BY state`).all() as { state: ImageJobState; n: number }[]) out[r.state] = r.n;
  return out;
}

const STATE_TEXT = { queued: 'Waiting to read…', fetching: 'Downloading the image…', running: 'Reading…' } as const;

/** Each attachment's image text as a note: the text, or where it has got to. */
export function imageNotes(db: PluginDb, attachmentIds: string[]): Map<string, Omit<AttachmentNote, 'pluginId'>> {
  if (!attachmentIds.length) return new Map();
  const rows = db
    .prepare(`SELECT attachment_id AS id, state, text, error FROM ${JOBS_TABLE} WHERE attachment_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(attachmentIds)) as { id: string; state: ImageJobState; text: string | null; error: string | null }[];
  const body = (r: (typeof rows)[number]): string => {
    if (r.state === 'done') return r.text || '(no text found)';
    if (r.state === 'failed') return `Reading the image failed: ${r.error ?? 'unknown error'}`;
    return STATE_TEXT[r.state];
  };
  return new Map(rows.map((r) => [r.id, { kind: IMAGE_TEXT_NOTE, state: r.state, label: 'image transcription', text: body(r) }]));
}
