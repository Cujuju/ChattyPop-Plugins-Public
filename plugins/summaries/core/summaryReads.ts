import { sumCosts, type ArchiveRead, type ArchiveToolScope } from '@plugin-sdk/core';
import type { ProviderId, AppUsage } from '@plugin-sdk/shared';
import type { Summary, SummaryPageQuery, SummarySpend, ProviderSpend } from '../shared/types';
import { COMPARISONS_TABLE, SUMMARIES_TABLE } from './schema';
import { RATE_RUNS, summaryPageSql, toSummary, type SummaryRow } from './summaryRows';

export async function costPerMessageRead(read: ArchiveRead, provider: ProviderId, model: string | null): Promise<number | null> {
  const r = (await read(`SELECT SUM(api_cost_usd) AS usd, SUM(message_count) AS messages FROM (
         SELECT api_cost_usd, message_count FROM ${SUMMARIES_TABLE}
         WHERE provider = ? AND model IS ? AND api_cost_usd IS NOT NULL AND message_count > 0 ORDER BY created_at DESC LIMIT ?)`, [provider, model, RATE_RUNS]))[0] as { usd: number | null; messages: number | null };
  return r.usd === null || !r.messages ? null : r.usd / r.messages;
}

export async function summarySpendRead(read: ArchiveRead, sinceTs: number): Promise<SummarySpend> {
  const col = (path: string): string => `json_extract(r.value, '$.${path}')`;
  const rows = (await read(`WITH runs AS (
         SELECT provider, input_tokens, cached_input_tokens, output_tokens, api_cost_usd, message_count, jev_cost_usd
         FROM ${SUMMARIES_TABLE} WHERE created_at >= ?
         UNION ALL
         SELECT ${col('model.provider')}, ${col('usage.inputTokens')}, ${col('usage.cachedInputTokens')}, ${col('usage.outputTokens')},
                ${col('apiCostUsd')}, c.message_count, ${col('jevCostUsd')}
         FROM ${COMPARISONS_TABLE} c, json_each(c.results_json) r WHERE c.created_at >= ? AND ${col('error')} IS NULL)
       SELECT provider, COUNT(*) AS runs, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(api_cost_usd), 0) AS apiCostUsd,
              SUM(api_cost_usd IS NULL AND message_count > 0) AS unpricedRuns, COALESCE(SUM(jev_cost_usd), 0) AS jev
       FROM runs GROUP BY provider ORDER BY apiCostUsd DESC, provider`, [sinceTs, sinceTs])) as (ProviderSpend & { jev: number })[];
  const sharedJev = (await read(`SELECT COALESCE(SUM(jev_cost_usd), 0) FROM ${COMPARISONS_TABLE} WHERE created_at >= ?`, [sinceTs])).map(row => Object.values(row as Record<string, unknown>)[0])[0] as number;
  return { providers: rows.map(({ jev: _, ...p }) => p), jevCostUsd: rows.reduce((n, r) => n + r.jev, sharedJev) };
}

export async function summaryUsageSinceRead(read: ArchiveRead, provider: ProviderId, sinceTs: number): Promise<AppUsage> {
  const p = (await summarySpendRead(read, sinceTs)).providers.find((x) => x.provider === provider);
  return { runs: p?.runs ?? 0, inputTokens: p?.inputTokens ?? 0, cachedInputTokens: p?.cachedInputTokens ?? 0, outputTokens: p?.outputTokens ?? 0 };
}

export async function summaryPageRead(read: ArchiveRead, q: SummaryPageQuery, scope?: ArchiveToolScope): Promise<Summary[]> {
  const query = summaryPageSql(q, scope);
  return ((await read(query.sql, [...query.params])) as SummaryRow[]).map(toSummary);
}
