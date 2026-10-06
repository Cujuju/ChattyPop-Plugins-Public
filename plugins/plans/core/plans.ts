// #67: Jev detects plans and decisions; the selected provider extracts details. Code validates dates against message timestamps.
import type { PlanItem, PlanKind } from '../shared/types';
import { cutText, errorMessage, MS_PER_MIN } from '@plugin-sdk/shared';
import { clipMessage, type PluginDb, PluginInactiveError, deadline, LocalOnlyError, type PluginMessageQuestion, privacy, queryLabel, queryRequest, type ReadScope, type TextMessage, } from '@plugin-sdk/core';
import { PLAN_QUERY, PLAN_SUBJECT } from '../shared';
import { PENDING_TABLE, PLANS_TABLE } from './schema';

/** Longest title kept; the panel shows one line. */
const MAX_TITLE_CHARS = 120;
/** Extraction timeout; timed-out hits are dropped so later hits can proceed. */
export const PLAN_EXTRACTION_DEADLINE_MS = 2 * MS_PER_MIN;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'What is planned or decided, in a few words' },
    when: { type: ['string', 'null'], description: 'ISO 8601 date or date-time it happens, resolved against sent_at; null if none is stated' },
    who: { type: 'array', items: { type: 'string' }, description: 'People involved, as named in the chat' },
    details: { type: 'string', description: 'Place, conditions or anything else needed, one or two sentences' },
  },
  required: ['title', 'when', 'who', 'details'],
  additionalProperties: false,
} as const;

const SYSTEM =
  'You extract one plan or decision from a chat message as JSON. Resolve relative dates ("tomorrow", "Friday 6pm") against sent_at, ' +
  "in the sender's time zone offset given there. Never invent a date: use null when none is stated.";

/** The provider chosen for extraction, with its Settings → AI model. */
export interface PlanProvider {
  /** Settles at once when `signal` (its deadline) aborts; rejects with LocalOnlyError when the provider may not read `reads`. */
  complete(req: { system: string; prompt: string; schema: Record<string, unknown>; signal: AbortSignal; reads: ReadScope }): Promise<{ json?: unknown }>;
}

export interface PlanDeps {
  /** The activation's database: once it ends, the writes of an extraction still running throw, and its hit stays pending. */
  db: PluginDb;
  /** The chosen provider, or why there is none (none chosen, or it can't run): the hit is then dropped. */
  provider(): PlanProvider | string;
  changed(channelId: string): void;
}

interface Extracted {
  title: string;
  when: string | null;
  who: string[];
  details: string;
}

/** A local ISO time with its offset, so the model resolves "tomorrow" in the owner's day. */
function localIso(ts: number): string {
  const d = new Date(ts);
  const off = -d.getTimezoneOffset();
  const pad = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(ts + off * MS_PER_MIN).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

/** ISO 8601 as the schema asks: a date, optionally a time (seconds and fraction optional) and an offset. */
const ISO_WHEN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** Validates ISO dates against calendar and clock values. Date-only values use local midnight; invalid values return null. */
export function parseWhen(when: string | null): number | null {
  const parts = when ? ISO_WHEN.exec(when) : null;
  if (!when || !parts) return null;
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, sec = 0] = parts.slice(1, 7).map((p) => Number(p ?? 0));
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  const real = check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d && check.getUTCHours() === h && check.getUTCMinutes() === mi && check.getUTCSeconds() === sec;
  if (!real) return null;
  const ts = Date.parse(parts[4] === undefined ? `${when}T00:00:00` : when);
  return Number.isFinite(ts) ? ts : null;
}

/** Registers planDetection and persists hits until extraction completes. Sequential processing resumes pending hits first; deactivation rejects writes and leaves queued hits for the next activation. */
export function planQuestion(deps: PlanDeps): PluginMessageQuestion<'planDetection'> {
  const { db } = deps;
  let queue: Promise<void> = Promise.resolve();
  const run = async (id: string): Promise<void> => {
    const kind = db.prepare(`SELECT kind FROM ${PENDING_TABLE} WHERE message_id = ?`).pluck().get(id) as PlanKind | undefined;
    if (!kind) return;
    try {
      const m = db
        .prepare(`SELECT id, channel_id AS channelId, author_id AS authorId, ts, text AS content, linked FROM archive_all_messages WHERE id = ?`)
        .get(id) as TextMessage | undefined;
      if (m) await extract(deps, m, kind);
    } catch (err) {
      if (err instanceof PluginInactiveError) return; // turned off mid-extraction: pending for the next activation
      console.warn('[plans] extraction failed:', errorMessage(err));
    }
    db.prepare(`DELETE FROM ${PENDING_TABLE} WHERE message_id = ?`).run(id);
  };
  // Failures outside extraction leave the hit pending; later hits continue processing.
  const schedule = (id: string): void =>
    void (queue = queue.then(() => run(id)).catch((err: unknown) => void (err instanceof PluginInactiveError || console.warn('[plans] pending hit failed:', errorMessage(err)))));
  for (const id of db.prepare(`SELECT message_id FROM ${PENDING_TABLE} ORDER BY queued_at, rowid`).pluck().all() as string[]) schedule(id);
  return {
    subject: PLAN_SUBJECT,
    feature: 'planDetection',
    question: () => queryRequest(PLAN_QUERY),
    onAnswer: (m, a) => {
      const kind = queryLabel(PLAN_QUERY, a);
      if (kind !== 'plan' && kind !== 'decision') return;
      db.prepare(
        `INSERT INTO ${PENDING_TABLE} (message_id, kind, queued_at) VALUES (?, ?, ?) ON CONFLICT (message_id) DO UPDATE SET kind = excluded.kind`,
      ).run(m.id, kind, Date.now());
      schedule(m.id);
    },
  };
}

async function extract(deps: PlanDeps, m: TextMessage, kind: PlanKind): Promise<void> {
  const { db } = deps;
  if (db.prepare(`SELECT 1 FROM ${PLANS_TABLE} WHERE message_id = ?`).get(m.id)) return;
  const provider = deps.provider();
  if (typeof provider === 'string') {
    console.warn(`[plans] not extracted: ${provider}`);
    return;
  }
  const prompt = JSON.stringify({ kind, sent_at: localIso(m.ts), message: clipMessage(m.content) });
  let r: { json?: unknown };
  try {
    r = await provider.complete({ system: SYSTEM, prompt, schema: SCHEMA, signal: deadline(PLAN_EXTRACTION_DEADLINE_MS), reads: [m.channelId] });
  } catch (err) {
    // Local-AI-only channels (#38): a hosted provider may not read them, so the hit is dropped.
    if (err instanceof LocalOnlyError) return;
    throw err;
  }
  const x = r.json as Extracted | undefined;
  if (!x?.title) return;
  db.prepare(`INSERT OR IGNORE INTO ${PLANS_TABLE} (message_id, channel_id, kind, title, when_ts, who_json, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    m.id,
    m.channelId,
    kind,
    cutText(x.title, MAX_TITLE_CHARS),
    parseWhen(x.when),
    JSON.stringify(x.who ?? []),
    x.details ?? '',
    Date.now(),
  );
  deps.changed(m.channelId);
}

/** Plans soonest first (undated after dated), then decisions newest first. */
export function planList(db: PluginDb, limit: number): PlanItem[] {
  // CROSS JOIN forces plan-driven archive lookups.
  const rows = db
    .prepare(
      `SELECT p.message_id AS messageId, p.channel_id AS channelId, COALESCE(c.name, p.channel_id) AS channelName, p.kind, p.title,
              p.when_ts AS whenTs, p.who_json AS whoJson, p.details, m.ts
       FROM ${PLANS_TABLE} p CROSS JOIN archive_messages m ON m.id = p.message_id LEFT JOIN archive_all_channels c ON c.id = p.channel_id
       ORDER BY p.kind = 'decision', CASE WHEN p.kind = 'plan' THEN p.when_ts IS NULL END, CASE WHEN p.kind = 'plan' THEN p.when_ts END, m.ts DESC
       LIMIT ?`,
    )
    .all(limit) as (Omit<PlanItem, 'who'> & { whoJson: string })[];
  const { redact } = privacy(db);
  return rows.map(({ whoJson, ...r }) => ({ ...r, title: redact(r.title), details: redact(r.details), who: JSON.parse(whoJson) as string[] }));
}
