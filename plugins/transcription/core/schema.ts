// Transcription's tables: the queue and its results (the text itself is also the host's derived text).
import { pluginTable } from '@plugin-sdk/shared';
import { plugin } from '../shared';

/**
 * Audio attachments' jobs, adopted from `transcripts` (when it was built in; the descriptor's adopts). Copied into
 * JOBS_TABLE once and kept, not kept in step: a Transcription build before part jobs (a downgrade) opening the profile
 * sees only the jobs made before the copy, so it may transcribe a newer one again.
 */
export const ATTACHMENT_JOBS_TABLE = pluginTable(plugin, 'jobs');
/** One job per audio or video part of a message (archive.parts). */
export const JOBS_TABLE = pluginTable(plugin, 'part_jobs');

/**
 * Transcription's schema steps (ctx.storage.migrate); append, never edit a shipped one.
 * Step 1: JOBS_TABLE keyed by message and part key (`attachment:<id>` for an attachment, as partKey made it then);
 * `kind` is audio | video; `url` is set where there is no attachment row to read it from. AUTOINCREMENT: `seq` keys a
 * part's derived text, so it is never reused. The adopted table is created empty when the profile never had it.
 */
export const TRANSCRIPTION_MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ${ATTACHMENT_JOBS_TABLE} (seq INTEGER PRIMARY KEY, attachment_id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL,
     state TEXT NOT NULL, priority INTEGER NOT NULL, requested_at INTEGER NOT NULL, text TEXT, segments TEXT, language TEXT, model TEXT,
     error TEXT, done_at INTEGER);
   CREATE TABLE ${JOBS_TABLE} (seq INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, part_key TEXT NOT NULL, kind TEXT NOT NULL,
     attachment_id TEXT, url TEXT, state TEXT NOT NULL, priority INTEGER NOT NULL, requested_at INTEGER NOT NULL, text TEXT, segments TEXT,
     language TEXT, model TEXT, error TEXT, done_at INTEGER, UNIQUE (message_id, part_key));
   CREATE INDEX ${JOBS_TABLE}_state ON ${JOBS_TABLE} (state, priority, requested_at);
   INSERT INTO ${JOBS_TABLE} (seq, message_id, part_key, kind, attachment_id, state, priority, requested_at, text, segments, language, model, error, done_at)
     SELECT seq, message_id, 'attachment:' || attachment_id, 'audio', attachment_id, state, priority, requested_at, text, segments, language, model, error, done_at
     FROM ${ATTACHMENT_JOBS_TABLE};`,
];
