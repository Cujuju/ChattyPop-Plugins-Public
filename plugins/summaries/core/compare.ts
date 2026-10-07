// Model comparisons: the log is read and prepared once (Jev's shared steps included), then every model writes from it.
import { errorMessage, type AiSettings } from '@plugin-sdk/shared';
import { sumCosts, type PluginDb } from '@plugin-sdk/core';
import type { Comparison, ComparisonHead, CompareProgress, CompareRequest } from '../shared/compare';
import type { SummarySettings } from '../shared/settings';
import type { SummaryProviders } from './providers';
import { NOTHING_NOTABLE, withModel, type Summarizer } from './summarize';
import { chunkLog, partRequests, prepareLog, writeSummary, type SentRequest } from './summaryWrite';
import { createHash } from 'node:crypto';
import { comparisonHeads, deleteComparison, insertComparison, readComparison, type StoredResult } from './compareRows';

/** A fingerprint of the requests that summarize the log's parts: equal only when every byte sent is equal. */
const digestOf = (reqs: SentRequest[]): string => createHash('sha256').update(JSON.stringify(reqs)).digest('hex');

export class Comparer {
  constructor(
    private readonly db: PluginDb,
    private readonly summarizer: Summarizer,
    private readonly providers: SummaryProviders,
    private readonly progress: (p: CompareProgress) => void,
    /** A comparison was stored or deleted. */
    private readonly changed: () => void = () => undefined,
  ) {}

  /**
   * Runs every model in `req` on one log: the same messages, parts, prompts and Jev steps, so only the model differs.
   * The models run at once; one failing fails only its column.
   */
  async run(req: CompareRequest, settings: AiSettings, prefs: SummarySettings): Promise<Comparison> {
    const signal = this.summarizer.lifetime;
    const total = req.models.length;
    this.progress({ phase: 'preparing', done: 0, total });
    // Throws, naming why, when a provider can't run or is turned off in Settings → AI providers.
    const models = req.models.map((m) => ({ m, provider: this.providers.get(m.provider, withModel(settings, m.provider, m.model, m.effort)) }));
    const input = this.summarizer.input(req, settings, prefs, [...new Set(req.models.map((m) => m.provider))]);
    const { sent: log, jevCosts } = await prepareLog(input.afterRules, input.jev, () => undefined, signal);
    // One cut for all: the smallest input budget, so every model reads the same parts.
    const maxChars = Math.min(...models.map((x) => x.provider.maxInputChars));
    const { chunks, jevCosts: chunkCosts } = log.length ? await chunkLog(log, maxChars, input.jev.chunk, signal) : { chunks: [], jevCosts: [] };

    // What every model must be sent; each model's own record of what it sent is checked against it.
    const inputDigest = digestOf(partRequests({ ...input, chunks }));
    let done = 0;
    this.progress({ phase: 'writing', done, total });
    const results = await Promise.all(models.map(async ({ m, provider }): Promise<StoredResult> => {
      const started = Date.now();
      const sent: SentRequest[] = [];
      try {
        // #56: a range with nothing notable needs no summary call.
        if (!log.length) return { model: m, error: null, durationMs: 0, inputDigest, headline: NOTHING_NOTABLE, items: [], actions: [], themes: null, usage: null, apiCostUsd: null, jevCostUsd: null };
        const w = await writeSummary({ ...input, provider, model: m.model, effort: m.effort, sent: log, chunks }, () => undefined, signal, (stage, req) => {
          if (stage === 'part') sent.push(req);
        });
        const { jevCosts: own, ...written } = w;
        return { model: m, error: null, durationMs: Date.now() - started, inputDigest: digestOf(sent), ...written, jevCostUsd: own.length ? sumCosts(own) : null };
      } catch (err) {
        signal.throwIfAborted();
        return { model: m, error: errorMessage(err), durationMs: Date.now() - started, inputDigest: sent.length ? digestOf(sent) : null };
      } finally {
        this.progress({ phase: 'writing', done: ++done, total });
      }
    }));
    signal.throwIfAborted();
    const shared = [...jevCosts, ...chunkCosts];
    const id = insertComparison(this.db, {
      sinceTs: req.sinceTs,
      untilTs: input.untilTs,
      scope: req.scope ?? null,
      channelIds: input.channelIds,
      messageCount: log.length,
      skippedCount: input.lines.length - log.length,
      grouping: input.opts.grouping,
      jevCostUsd: shared.length ? sumCosts(shared) : null,
      inputDigest,
      results,
    });
    this.progress({ phase: 'done', done: total, total });
    this.changed();
    return this.get(id)!;
  }

  list(): ComparisonHead[] {
    return comparisonHeads(this.db);
  }

  /** A comparison as privacy mode shows it; null when deleted or hidden. */
  get(id: number): Comparison | null {
    return readComparison(this.db, id, (s) => this.summarizer.shown(s));
  }

  delete(id: number): boolean {
    const gone = deleteComparison(this.db, id);
    if (gone) this.changed();
    return gone;
  }
}
