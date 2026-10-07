// Comparison rows as stored, and each model's column read back as a summary.
import { sumCosts, type PluginDb } from '@plugin-sdk/core';
import type { TokenUsage } from '@plugin-sdk/shared';
import type { CompareModel, Comparison, ComparisonHead } from '../shared/compare';
import type { SummaryGrouping } from '../shared/settings';
import type { Summary, SummaryItem, SummaryTheme } from '../shared/types';
import { COMPARISONS_TABLE, VISIBLE_COMPARISONS } from './schema';

/** One model's column as results_json holds it; the written fields are absent when it failed. */
export interface StoredResult {
  model: CompareModel;
  error: string | null;
  /** The time the model's own calls took. */
  durationMs: number;
  headline?: string;
  items?: SummaryItem[];
  actions?: SummaryItem[];
  themes?: SummaryTheme[] | null;
  usage?: TokenUsage | null;
  apiCostUsd?: number | null;
  /** Jev's citation check and key themes for this column, in USD; null when none reported a cost. */
  jevCostUsd?: number | null;
}

export interface NewComparison {
  sinceTs: number;
  untilTs: number;
  channelIds: string[];
  messageCount: number;
  skippedCount: number;
  grouping: SummaryGrouping;
  jevCostUsd: number | null;
  results: StoredResult[];
}

interface ComparisonRow {
  id: number;
  created_at: number;
  since_ts: number;
  until_ts: number;
  channel_ids: string;
  message_count: number;
  skipped_count: number;
  grouping: SummaryGrouping;
  jev_cost_usd: number | null;
  results_json: string;
}

export function insertComparison(db: PluginDb, c: NewComparison): number {
  const info = db
    .prepare(
      `INSERT INTO ${COMPARISONS_TABLE} (created_at, since_ts, until_ts, channel_ids, message_count, skipped_count, grouping, jev_cost_usd, results_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(Date.now(), c.sinceTs, c.untilTs, JSON.stringify(c.channelIds), c.messageCount, c.skippedCount, c.grouping, c.jevCostUsd, JSON.stringify(c.results));
  return Number(info.lastInsertRowid);
}

function headOf(r: ComparisonRow, results: StoredResult[]): ComparisonHead {
  const costs = results.flatMap((x) => (typeof x.apiCostUsd === 'number' ? [x.apiCostUsd] : []));
  return {
    id: r.id,
    createdAt: r.created_at,
    sinceTs: r.since_ts,
    untilTs: r.until_ts,
    models: results.map((x) => x.model),
    failed: results.filter((x) => x.error !== null).length,
    messageCount: r.message_count,
    apiCostUsd: costs.length ? sumCosts(costs) : null,
  };
}

/** Stored comparisons as privacy mode lists them, newest first. */
export function comparisonHeads(db: PluginDb): ComparisonHead[] {
  const rows = db.prepare(`SELECT * FROM ${VISIBLE_COMPARISONS} ORDER BY created_at DESC, id DESC`).all() as ComparisonRow[];
  return rows.map((r) => headOf(r, JSON.parse(r.results_json) as StoredResult[]));
}

/** A stored comparison with each column as a summary (`shown` applies privacy mode and names people); null when gone or hidden. */
export function readComparison(db: PluginDb, id: number, shown: (s: Summary) => Summary): Comparison | null {
  const r = db.prepare(`SELECT * FROM ${VISIBLE_COMPARISONS} WHERE id = ?`).get(id) as ComparisonRow | undefined;
  if (!r) return null;
  const stored = JSON.parse(r.results_json) as StoredResult[];
  const channelIds = JSON.parse(r.channel_ids) as string[];
  const summaryOf = (x: StoredResult): Summary => ({
    id: r.id,
    createdAt: r.created_at,
    provider: x.model.provider,
    model: x.model.model,
    sinceTs: r.since_ts,
    untilTs: r.until_ts,
    channelIds,
    messageCount: r.message_count,
    skippedCount: r.skipped_count,
    durationMs: x.durationMs,
    headline: x.headline ?? '',
    items: x.items ?? [],
    actions: x.actions ?? [],
    grouping: r.grouping,
    trigger: 'manual',
    usage: x.usage ?? null,
    apiCostUsd: x.apiCostUsd ?? null,
    apiCostEstimated: false,
    jevCostUsd: x.jevCostUsd ?? null,
    themes: x.themes ?? null,
    people: {},
    authors: {},
  });
  return {
    ...headOf(r, stored),
    channelIds,
    skippedCount: r.skipped_count,
    grouping: r.grouping,
    jevCostUsd: r.jev_cost_usd,
    results: stored.map((x) => ({ model: x.model, error: x.error, summary: x.error === null ? shown(summaryOf(x)) : null })),
  };
}

/** Whether a comparison was there to delete. */
export const deleteComparison = (db: PluginDb, id: number): boolean => db.prepare(`DELETE FROM ${COMPARISONS_TABLE} WHERE id = ?`).run(id).changes > 0;
