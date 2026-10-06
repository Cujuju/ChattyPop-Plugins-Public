// The jobs table: one row per translated part of a message, its queue state, the hash of its source text and the
// translation.
import { pluginTable } from '@plugin-sdk/shared';
import type { PluginDb, PluginNote } from '@plugin-sdk/core';
import { TRANSLATION_NOTE, plugin } from '../shared';
import { normalizeTranslatePick, type SourceKind, type TranslatePick, type TranslationJobState } from '../shared/types';

export const JOBS_TABLE = pluginTable(plugin, 'jobs');

/** Append-only translation migrations. part_key identifies parts; source_hash tracks language/text changes; null translation marks target-language source text; pick stores TranslatePick or null for Settings' model. */
export const TRANSLATION_MIGRATIONS: readonly string[] = [
  `CREATE TABLE ${JOBS_TABLE} (seq INTEGER PRIMARY KEY, message_id TEXT NOT NULL, channel_id TEXT NOT NULL, part_key TEXT NOT NULL,
     kind TEXT NOT NULL, source_hash TEXT NOT NULL, state TEXT NOT NULL, priority INTEGER NOT NULL, requested_at INTEGER NOT NULL,
     pick TEXT, translation TEXT, error TEXT, done_at INTEGER, UNIQUE (message_id, part_key));
   CREATE INDEX ${JOBS_TABLE}_state ON ${JOBS_TABLE} (state, priority, requested_at);`,
];

export const PRIORITY = { automatic: 0, requested: 1 } as const;
/** Jobs that run without Settings' model. */
const OWN_MODEL = 'pick IS NOT NULL';

/** A part's text to translate, hashed. */
export interface QueuedSource {
  key: string;
  kind: SourceKind;
  hash: string;
}

export interface TranslationJob {
  seq: number;
  messageId: string;
  channelId: string;
  partKey: string;
  requestedAt: number;
  pick: TranslatePick | null;
}

/** Automatic enqueue adds new/changed sources using earlier picks. Manual enqueue replaces all sources with pick. Returns whether jobs changed. */
export function enqueue(db: PluginDb, messageId: string, channelId: string, sources: readonly QueuedSource[], priority: number, now: number, pick?: TranslatePick | null): boolean {
  const asked = pick !== undefined;
  const insert = db.prepare(
    `INSERT INTO ${JOBS_TABLE} (message_id, channel_id, part_key, kind, source_hash, state, priority, requested_at, pick)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)
     ON CONFLICT (message_id, part_key) DO UPDATE SET state = 'queued', source_hash = excluded.source_hash, kind = excluded.kind,
       error = NULL, requested_at = excluded.requested_at${asked ? ', priority = MAX(priority, excluded.priority), pick = excluded.pick' : ''}
     WHERE state != 'running'${asked ? '' : ' AND source_hash != excluded.source_hash'}`,
  );
  const picked = pick ? JSON.stringify(pick) : null;
  let changed = 0;
  for (const s of sources) changed += insert.run(messageId, channelId, s.key, s.kind, s.hash, priority, now, picked).changes;
  return changed > 0;
}

/** The next job to run: owner requests first, then oldest first. `ownModelOnly`: jobs with a picked model (Settings' can't run). */
export function nextJob(db: PluginDb, ownModelOnly: boolean): TranslationJob | undefined {
  const row = db
    .prepare(
      `SELECT seq, message_id AS messageId, channel_id AS channelId, part_key AS partKey, requested_at AS requestedAt, pick
       FROM ${JOBS_TABLE} WHERE state = 'queued' AND (? = 0 OR ${OWN_MODEL}) ORDER BY priority DESC, requested_at, seq LIMIT 1`,
    )
    .get(ownModelOnly ? 1 : 0) as (Omit<TranslationJob, 'pick'> & { pick: string | null }) | undefined;
  return row && { ...row, pick: row.pick ? normalizeTranslatePick(JSON.parse(row.pick)) : null };
}

export function setState(db: PluginDb, seq: number, state: TranslationJobState): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = ? WHERE seq = ?`).run(state, seq);
}

/** `translation` of the source hashed `hash`; null: already in the language. */
export function finish(db: PluginDb, seq: number, translation: string | null, hash: string, now: number): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'done', translation = ?, source_hash = ?, error = NULL, done_at = ? WHERE seq = ?`).run(translation, hash, now, seq);
}

export function fail(db: PluginDb, seq: number, error: string): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'failed', error = ? WHERE seq = ?`).run(error, seq);
}

/** A job's stored translation; null when none. */
export const jobTranslation = (db: PluginDb, seq: number): string | null =>
  (db.prepare(`SELECT translation FROM ${JOBS_TABLE} WHERE seq = ?`).pluck().get(seq) as string | null | undefined) ?? null;

/** Jobs a quit or turning off interrupted start over. */
export function resetInterrupted(db: PluginDb): void {
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'queued' WHERE state = 'running'`).run();
}

/** Failed jobs queued again; returns their messages. */
export function retryFailed(db: PluginDb, now: number): string[] {
  const ids = db.prepare(`SELECT DISTINCT message_id FROM ${JOBS_TABLE} WHERE state = 'failed'`).pluck().all() as string[];
  db.prepare(`UPDATE ${JOBS_TABLE} SET state = 'queued', error = NULL, requested_at = ? WHERE state = 'failed'`).run(now);
  return ids;
}

/** Whether any part of the message is still being translated; `ownModelOnly`: by a job with a picked model. */
export function messageActive(db: PluginDb, messageId: string, ownModelOnly: boolean): boolean {
  return db.prepare(`SELECT 1 FROM ${JOBS_TABLE} WHERE message_id = ? AND state IN ('queued', 'running') AND (? = 0 OR ${OWN_MODEL}) LIMIT 1`).get(messageId, ownModelOnly ? 1 : 0) !== undefined;
}

/** The message's jobs: each part queued or translated, its state and translation. */
export function messageJobs(db: PluginDb, messageId: string): { seq: number; partKey: string; state: TranslationJobState; translation: string | null; requestedAt: number }[] {
  return db
    .prepare(`SELECT seq, part_key AS partKey, state, translation, requested_at AS requestedAt FROM ${JOBS_TABLE} WHERE message_id = ?`)
    .all(messageId) as { seq: number; partKey: string; state: TranslationJobState; translation: string | null; requestedAt: number }[];
}

/** Removes jobs (parts whose text is gone). */
export function dropJobs(db: PluginDb, seqs: readonly number[]): void {
  db.prepare(`DELETE FROM ${JOBS_TABLE} WHERE seq IN (SELECT value FROM json_each(?))`).run(JSON.stringify(seqs));
}

export const queuedJobs = (db: PluginDb): boolean => db.prepare(`SELECT 1 FROM ${JOBS_TABLE} WHERE state = 'queued' LIMIT 1`).get() !== undefined;

export function counts(db: PluginDb): Record<TranslationJobState, number> {
  const out: Record<TranslationJobState, number> = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const r of db.prepare(`SELECT state, COUNT(*) AS n FROM ${JOBS_TABLE} GROUP BY state`).all() as { state: TranslationJobState; n: number }[]) out[r.state] = r.n;
  return out;
}

const STATE_TEXT = { queued: 'Waiting to translate…', running: 'Translating…' } as const;

/** Produces translation or progress notes. Already-target-language text gets a note only for explicit requests. */
export function translationNotes(db: PluginDb, messageIds: string[]): Map<string, Map<string, PluginNote>> {
  const out = new Map<string, Map<string, PluginNote>>();
  if (!messageIds.length) return out;
  const rows = db
    .prepare(`SELECT message_id AS messageId, part_key AS part, state, priority, translation, error FROM ${JOBS_TABLE} WHERE message_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(messageIds)) as { messageId: string; part: string; state: TranslationJobState; priority: number; translation: string | null; error: string | null }[];
  const body = (r: (typeof rows)[number]): string | null => {
    if (r.state === 'done') return r.translation ?? (r.priority === PRIORITY.requested ? 'Already in your language.' : null);
    if (r.state === 'failed') return `Translating failed: ${r.error ?? 'unknown error'}`;
    return STATE_TEXT[r.state];
  };
  for (const r of rows) {
    const text = body(r);
    if (text === null) continue;
    const parts = out.get(r.messageId) ?? new Map<string, PluginNote>();
    parts.set(r.part, { kind: TRANSLATION_NOTE, state: r.state, label: 'translation', text });
    out.set(r.messageId, parts);
  }
  return out;
}
