// Summary rows as stored, and the pure helpers the Summarizer builds on.
import type { CitationCheck, Citation, Summary, SummaryItem, SummaryPageQuery, SummaryRequest, SummarySpend, SummaryTheme, ProviderSpend } from '../shared/types';
import type { AppUsage, TokenUsage } from '@plugin-sdk/shared';
import type { ProviderId } from '@plugin-sdk/shared';
import type { SummaryGrouping, SummaryTrigger } from '../shared/settings';
import { SUMMARIES_TABLE, VISIBLE_SUMMARIES } from './schema';
import type { CoverageSpan, PluginDb } from '@plugin-sdk/core';
import { sumCosts } from '@plugin-sdk/core';
import type { LogLine } from './summaryJev';

export interface SummaryRow {
  id: number;
  created_at: number;
  provider: ProviderId;
  model: string | null;
  since_ts: number;
  until_ts: number;
  channel_ids: string;
  message_count: number;
  duration_ms: number;
  headline: string;
  items_json: string;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  skipped_count: number;
  jev_cost_usd: number | null;
  api_cost_usd: number | null;
  api_cost_estimated: number;
  themes_json: string | null;
  run_trigger: SummaryTrigger;
  grouping: SummaryGrouping;
  actions_json: string;
}

/** A point as stored before points had parts: one text and every citation. */
interface WholePointRow {
  text: string;
  citations: Citation[];
  check?: CitationCheck;
}

/** Stored points; ones from before parts read as a single part. */
const pointsOf = (json: string): SummaryItem[] =>
  (JSON.parse(json) as (SummaryItem | WholePointRow)[]).map((i) =>
    'parts' in i ? i : { parts: [{ text: i.text, citations: i.citations }], ...(i.check ? { check: i.check } : {}) },
  );

export const toSummary = (r: SummaryRow): Summary => ({
  id: r.id,
  createdAt: r.created_at,
  provider: r.provider,
  model: r.model,
  sinceTs: r.since_ts,
  untilTs: r.until_ts,
  channelIds: JSON.parse(r.channel_ids),
  messageCount: r.message_count,
  skippedCount: r.skipped_count,
  durationMs: r.duration_ms,
  headline: r.headline,
  items: pointsOf(r.items_json),
  actions: pointsOf(r.actions_json),
  grouping: r.grouping,
  trigger: r.run_trigger,
  usage:
    r.input_tokens === null
      ? null
      : { inputTokens: r.input_tokens, cachedInputTokens: r.cached_input_tokens ?? 0, outputTokens: r.output_tokens ?? 0 },
  apiCostUsd: r.api_cost_usd,
  apiCostEstimated: r.api_cost_estimated === 1,
  jevCostUsd: r.jev_cost_usd,
  themes: r.themes_json ? (JSON.parse(r.themes_json) as SummaryTheme[]) : null,
  // Names change: they are read as a summary is shown (withPeople), never stored.
  people: {},
  authors: {},
});

/** Lines per channel, channels in first-seen order, each in log order. */
export function byChannel(lines: LogLine[]): LogLine[][] {
  const m = new Map<string, LogLine[]>();
  for (const l of lines) {
    const seq = m.get(l.citation.channelId);
    if (seq) seq.push(l);
    else m.set(l.citation.channelId, [l]);
  }
  return [...m.values()];
}

/** Jev asks about count lines starting at conversation[first]; the rest of conversation is their context. */
export interface ContextBatch {
  conversation: LogLine[];
  first: number;
  count: number;
}

/** Per-channel batches of up to 	argets lines, each with up to context neighbours on either side; channels never mix. */
export function contextBatches(lines: LogLine[], targets: number, context: number): ContextBatch[] {
  return byChannel(lines).flatMap((seq) =>
    Array.from({ length: Math.ceil(seq.length / targets) }, (_, b) => {
      const i = b * targets;
      const from = Math.max(0, i - context);
      const count = Math.min(targets, seq.length - i);
      return { conversation: seq.slice(from, i + count + context), first: i - from, count };
    }),
  );
}

/** Splits the log into consecutive chunks under the provider's input budget. */
export function chunk(lines: LogLine[], maxChars: number): LogLine[][] {
  const out: LogLine[][] = [];
  let cur: LogLine[] = [];
  let size = 0;
  for (const l of lines) {
    if (size + l.text.length > maxChars && cur.length) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.text.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

export const sumUsage = (all: TokenUsage[]): TokenUsage => ({
  inputTokens: all.reduce((n, u) => n + u.inputTokens, 0),
  cachedInputTokens: all.reduce((n, u) => n + u.cachedInputTokens, 0),
  outputTokens: all.reduce((n, u) => n + u.outputTokens, 0),
});

/** A finished run, as the Summarizer stores it. */
export interface NewSummary {
  cacheKey: string;
  providerId: ProviderId;
  model: string | null;
  req: SummaryRequest;
  untilTs: number;
  channelIds: string[];
  sent: number;
  skipped: number;
  started: number;
  headline: string;
  items: SummaryItem[];
  actions: SummaryItem[];
  usage: TokenUsage | null;
  apiCostUsd: number | null;
  jevCosts: number[];
  themes: SummaryTheme[] | null;
  trigger: SummaryTrigger;
  grouping: SummaryGrouping;
}

/** Stores a run and returns it as read back. */
export function insertSummary(db: PluginDb, r: NewSummary): Summary {
  const info = db
    .prepare(
      `INSERT INTO ${SUMMARIES_TABLE} (cache_key, created_at, provider, model, since_ts, until_ts, channel_ids, message_count, duration_ms, headline, items_json,
                              input_tokens, cached_input_tokens, output_tokens, skipped_count, jev_cost_usd, themes_json, run_trigger, grouping, actions_json,
                              api_cost_usd, people_linked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      r.cacheKey, Date.now(), r.providerId, r.model, r.req.sinceTs, r.untilTs, JSON.stringify(r.channelIds), r.sent, Date.now() - r.started, r.headline,
      JSON.stringify(r.items), r.usage?.inputTokens ?? null, r.usage?.cachedInputTokens ?? null, r.usage?.outputTokens ?? null, r.skipped,
      sumCosts(r.jevCosts), r.themes ? JSON.stringify(r.themes) : null,
      r.trigger, r.grouping, JSON.stringify(r.actions), r.apiCostUsd,
    );
  return toSummary(db.prepare(`SELECT * FROM ${SUMMARIES_TABLE} WHERE id = ?`).get(info.lastInsertRowid) as SummaryRow);
}

/** Summary runs with a provider since a time and the tokens they reported. */
/** Every summary's source span: its channels from since to until, so text retention may remove what it covers. */
export function coverageSpans(db: PluginDb): CoverageSpan[] {
  const rows = db.prepare(`SELECT channel_ids, since_ts, until_ts FROM ${SUMMARIES_TABLE}`).all() as {
    channel_ids: string;
    since_ts: number;
    until_ts: number;
  }[];
  return rows.map((r) => ({
    channelIds: JSON.parse(r.channel_ids) as string[],
    since: r.since_ts,
    until: r.until_ts,
  }));
}

/** Recent priced runs a cost-per-message rate averages; enough to smooth one unusual run, few enough to follow price changes. */
const RATE_RUNS = 10;

/** The model's cost per message read over its last RATE_RUNS priced runs, in USD; null when none was priced. */
export function costPerMessage(db: PluginDb, provider: ProviderId, model: string | null): number | null {
  const r = db
    .prepare(
      `SELECT SUM(api_cost_usd) AS usd, SUM(message_count) AS messages FROM (
         SELECT api_cost_usd, message_count FROM ${SUMMARIES_TABLE}
         WHERE provider = ? AND model IS ? AND api_cost_usd IS NOT NULL AND message_count > 0 ORDER BY created_at DESC LIMIT ?)`,
    )
    .get(provider, model, RATE_RUNS) as { usd: number | null; messages: number | null };
  return r.usd === null || !r.messages ? null : r.usd / r.messages;
}

/** What runs since `sinceTs` cost, per provider. A run that read no messages called no model. */
export function summarySpend(db: PluginDb, sinceTs: number): SummarySpend {
  const rows = db
    .prepare(
      `SELECT provider, COUNT(*) AS runs, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(api_cost_usd), 0) AS apiCostUsd,
              SUM(api_cost_usd IS NULL AND message_count > 0) AS unpricedRuns, COALESCE(SUM(jev_cost_usd), 0) AS jev
       FROM ${SUMMARIES_TABLE} WHERE created_at >= ? GROUP BY provider ORDER BY apiCostUsd DESC, provider`,
    )
    .all(sinceTs) as (ProviderSpend & { jev: number })[];
  return { providers: rows.map(({ jev: _, ...p }) => p), jevCostUsd: rows.reduce((n, r) => n + r.jev, 0) };
}

export function summaryUsageSince(db: PluginDb, provider: ProviderId, sinceTs: number): AppUsage {
  const p = summarySpend(db, sinceTs).providers.find((x) => x.provider === provider);
  return { runs: p?.runs ?? 0, inputTokens: p?.inputTokens ?? 0, cachedInputTokens: p?.cachedInputTokens ?? 0, outputTokens: p?.outputTokens ?? 0 };
}

/** Summary runs newest first, keyset-paged by (created_at, id). */
export function summaryPage(db: PluginDb, q: SummaryPageQuery): Summary[] {
  const b = q.before;
  const rows = db
    .prepare(`SELECT * FROM ${VISIBLE_SUMMARIES} s ${b ? 'WHERE (created_at, id) < (?, ?)' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...(b ? [b.createdAt, b.id] : []), q.limit) as SummaryRow[];
  return rows.map(toSummary);
}

/**
 * Where stored runs cover every one of `channelIds` without a gap from `sinceTs`: each channel's runs are chained from
 * there while one starts at or before the covered end; the least channel's end. Null when some channel isn't covered.
 */
export function coveredFrom(db: PluginDb, channelIds: readonly string[], sinceTs: number): number | null {
  const runs = (db.prepare(`SELECT channel_ids, since_ts, until_ts FROM ${SUMMARIES_TABLE} WHERE until_ts > ? ORDER BY since_ts`).all(sinceTs) as {
    channel_ids: string;
    since_ts: number;
    until_ts: number;
  }[]).map((r) => ({ channels: new Set(JSON.parse(r.channel_ids) as string[]), since: r.since_ts, until: r.until_ts }));
  let covered = Infinity;
  for (const channelId of channelIds) {
    let end = sinceTs;
    for (const run of runs) {
      if (run.since > end) break;
      if (run.channels.has(channelId)) end = Math.max(end, run.until);
    }
    covered = Math.min(covered, end);
  }
  return covered > sinceTs && covered !== Infinity ? covered : null;
}
