// Model comparisons (Settings → Summaries → Compare models): one prepared log, summarized by each chosen model.
import { isObj, normalizeProviderId, textOrNull, type ProviderId, type TokenUsage } from '@plugin-sdk/shared';
import type { SummaryGrouping } from './settings';
import type { Summary } from './types';

/** A model to compare: its provider, model (null = the provider's default) and thinking level (null = the model's default). */
export interface CompareModel {
  provider: ProviderId;
  model: string | null;
  effort: string | null;
}

export interface CompareRequest {
  sinceTs: number;
  untilTs?: number;
  models: CompareModel[];
}

/** One model's column: its summary, or why it failed. */
export interface CompareResult {
  model: CompareModel;
  /** Null when the model failed; its durationMs is the time its own calls took. */
  summary: Summary | null;
  error: string | null;
  /** Fingerprint of the part requests this model was sent; null when unknown (failed first, or an older comparison). */
  inputDigest: string | null;
}

/** One model in the list of comparisons: its tokens and API cost, or that it failed. */
export interface ColumnHead {
  model: CompareModel;
  /** Null when its provider reported none, or it failed. */
  usage: TokenUsage | null;
  /** At API rates, in USD; null when unknown. */
  apiCostUsd: number | null;
  failed: boolean;
}

/** A stored comparison as the list shows it. */
export interface ComparisonHead {
  id: number;
  createdAt: number;
  sinceTs: number;
  untilTs: number;
  /** Each model, in column order, with what its calls used and cost. */
  columns: ColumnHead[];
  /** Messages every model read. */
  messageCount: number;
  /** What the models' calls cost at API rates together, in USD; null when none reported a cost. */
  apiCostUsd: number | null;
}

export interface Comparison extends ComparisonHead {
  channelIds: string[];
  /** Messages in range left out as filler or quiet before any model read the log. */
  skippedCount: number;
  grouping: SummaryGrouping;
  /** What Jev's shared steps (filler, quiet stretches, conversation parts) cost, in USD; null when none reported a cost. */
  jevCostUsd: number | null;
  /** Fingerprint of the part requests every model was to be sent; null for comparisons from before it was kept. */
  inputDigest: string | null;
  results: CompareResult[];
}

/** Progress of a comparison: preparing the shared log, then models finished out of all. */
export interface CompareProgress {
  phase: 'preparing' | 'writing' | 'done' | 'error';
  done: number;
  total: number;
}

/** A stored or sent model, or null when it isn't one. */
export function normalizeCompareModel(v: unknown): CompareModel | null {
  if (!isObj(v)) return null;
  const provider = normalizeProviderId(v['provider']);
  return provider ? { provider, model: textOrNull(v['model']), effort: textOrNull(v['effort']) } : null;
}

/** Stored models, dropping any that aren't one. */
export const normalizeCompareModels = (v: unknown): CompareModel[] =>
  Array.isArray(v) ? v.map(normalizeCompareModel).filter((m): m is CompareModel => m !== null) : [];

/** A time in ms, or it throws. */
function time(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Not a ${what} time.`);
  return v;
}

/** compare's argument checked: a range and at least one model; throws the reason it isn't one. */
export function decodeCompareRequest([request]: readonly unknown[]): [CompareRequest] {
  if (!isObj(request)) throw new Error('Not a comparison request.');
  const { sinceTs, untilTs, models } = request;
  if (!Array.isArray(models) || !models.length) throw new Error('No models to compare.');
  const decoded = models.map(normalizeCompareModel);
  if (decoded.includes(null)) throw new Error('Not a model to compare.');
  return [{
    sinceTs: time(sinceTs, 'start'),
    ...(untilTs === undefined ? {} : { untilTs: time(untilTs, 'end') }),
    models: decoded as CompareModel[],
  }];
}

/** A stored comparison's id, or it throws. */
export function decodeComparisonId([id]: readonly unknown[]): [number] {
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error('Not a comparison id.');
  return [id];
}
