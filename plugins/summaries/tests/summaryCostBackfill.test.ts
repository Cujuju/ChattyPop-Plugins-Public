// Contract: runs stored without a model cost are estimated once from their tokens, and marked estimated.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@core/db';
import type { PricedUsage } from '@core/ai/apiRates';
import { SUMMARIES_TABLE } from '../core/schema';
import { estimateMissingCosts } from '../core/costBackfill';
import { summaryPage } from '../core/summaryRows';
import { adoptSummaries } from './summariesHarness';
import { tempDb } from '@chattypop/host-testing';

/** USD per token every model is priced at here. */
const RATE = 0.001;

let db: Db;
beforeEach(() => {
  db = adoptSummaries(tempDb());
});

/** Stores a run; `tokens` null = the provider reported no usage. */
function store(id: number, provider: string, model: string | null, cost: number | null, tokens: number | null, messages = 10): void {
  db.prepare(
    `INSERT INTO ${SUMMARIES_TABLE} (id, cache_key, created_at, provider, model, since_ts, until_ts, channel_ids, message_count, duration_ms, headline,
       items_json, actions_json, input_tokens, cached_input_tokens, output_tokens, skipped_count, api_cost_usd, run_trigger, grouping)
     VALUES (?, ?, ?, ?, ?, 0, 1, '[]', ?, 0, 'h', '[]', '[]', ?, 0, ?, 0, ?, 'manual', 'overall')`,
  ).run(id, `k${id}`, id, provider, model, messages, tokens, tokens === null ? null : 0, cost);
}

describe('estimating stored runs without a cost', () => {
  it('prices each known model once, marks it estimated, and leaves the rest', async () => {
    store(1, 'codex', 'gpt-6-luna', null, 100);
    store(2, 'claude', 'opus', null, 200);
    store(3, 'claude', 'opus', 0.5, 300); // reported by its calls: untouched
    store(4, 'ollama', 'llama', null, 400); // no API price
    store(5, 'claude', null, null, null); // no usage to price
    store(6, 'codex', 'gpt-6-luna', null, 100, 0); // read nothing, called no model
    const asked: string[] = [];
    const price = async (id: string, u: PricedUsage): Promise<number> => {
      asked.push(id);
      return u.inputTokens * RATE;
    };

    expect(await estimateMissingCosts(db, price)).toBe(2);
    expect(asked).toEqual(['openai/gpt-6-luna', '~anthropic/claude-opus-latest']);
    const byId = new Map(summaryPage(db, { limit: 10 }).map((s) => [s.id, [s.apiCostUsd, s.apiCostEstimated]]));
    expect(Object.fromEntries(byId)).toEqual({
      1: [0.1, true],
      2: [0.2, true],
      3: [0.5, false],
      4: [null, false],
      5: [null, false],
      6: [null, false],
    });
    // Nothing left to price the second time.
    expect(await estimateMissingCosts(db, price)).toBe(0);
  });
});
