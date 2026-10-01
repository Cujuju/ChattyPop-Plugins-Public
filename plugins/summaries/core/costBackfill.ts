// Estimates the model cost of runs stored without one (before costs were kept) from their stored tokens.
import type { PluginDb, PriceAtApiRates } from '@plugin-sdk/core';
import { errorMessage, type ProviderId } from '@plugin-sdk/shared';
import { SUMMARIES_TABLE } from './schema';

/** Claude Code's model aliases; OpenRouter's `-latest` ids name the release each alias resolves to. */
const CLAUDE_ALIASES = new Set(['opus', 'sonnet', 'haiku']);

/**
 * The OpenRouter id pricing a stored run's model; null when unknown. Covers the providers that stored runs without a
 * cost: Codex and Claude (plan-paid) and OpenRouter (its own ids). Claude's alias is priced at today's release.
 */
function openRouterId(provider: ProviderId, model: string | null): string | null {
  if (!model) return null;
  if (provider === 'codex') return `openai/${model}`;
  if (provider === 'claude') return CLAUDE_ALIASES.has(model) ? `~anthropic/claude-${model}-latest` : null;
  if (provider === 'openrouter') return model;
  return null;
}

interface UnpricedRow {
  id: number;
  provider: ProviderId;
  model: string | null;
  input_tokens: number;
  cached_input_tokens: number | null;
  output_tokens: number | null;
}

/**
 * Prices every run that called a model but stored no cost, at today's API list rates, and marks it estimated. The
 * stored sums don't split out cache writes or the largest single prompt, so writes are priced as fresh prompt and
 * long-context tiers are missed: an estimate on the low side. Runs it can't price stay unpriced and are retried next start.
 */
export async function estimateMissingCosts(db: PluginDb, price: PriceAtApiRates): Promise<number> {
  const rows = db
    .prepare(
      `SELECT id, provider, model, input_tokens, cached_input_tokens, output_tokens FROM ${SUMMARIES_TABLE}
       WHERE api_cost_usd IS NULL AND input_tokens IS NOT NULL AND message_count > 0`,
    )
    .all() as UnpricedRow[];
  const update = db.prepare(`UPDATE ${SUMMARIES_TABLE} SET api_cost_usd = ?, api_cost_estimated = 1 WHERE id = ? AND api_cost_usd IS NULL`);
  let priced = 0;
  for (const r of rows) {
    const id = openRouterId(r.provider, r.model);
    if (!id) continue;
    try {
      const usd = await price(id, {
        inputTokens: r.input_tokens,
        cachedInputTokens: r.cached_input_tokens ?? 0,
        cacheWriteInputTokens: 0,
        outputTokens: r.output_tokens ?? 0,
        largestPromptTokens: 0,
      });
      if (usd !== undefined) priced += update.run(usd, r.id).changes;
    } catch (err) {
      console.warn('[summary] estimating a stored run cost failed:', errorMessage(err));
    }
  }
  return priced;
}
