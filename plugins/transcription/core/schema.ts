// Transcription's tables: the queue and its results (the text itself is also the host's derived text).
import { pluginTable } from '@plugin-sdk/shared';
import { plugin } from '../shared';

/** Adopts legacy transcripts once into JOBS_TABLE. Downgraded builds see only pre-copy jobs and may transcribe newer attachments again. */
export const ATTACHMENT_JOBS_TABLE = pluginTable(plugin, 'jobs');
/** One job per audio or video part of a message (archive.parts). */
export const JOBS_TABLE = pluginTable(plugin, 'part_jobs');

/** Append-only transcription migrations. JOBS_TABLE keys message/part; kind identifies audio/video; url covers nonattachments. AUTOINCREMENT seq prevents derived-text key reuse. Missing legacy tables start empty. */
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
