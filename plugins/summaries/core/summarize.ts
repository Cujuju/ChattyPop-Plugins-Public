// Queued summary generation, caching and progress.
import { createHash } from 'node:crypto';
import type { Summary, SummaryEstimate, SummaryPageQuery, SummaryPrompts, SummaryRequest } from '../shared/types';
import type { AppUsage } from '@plugin-sdk/shared';
import type { SummaryEvent as AppEvent } from '../shared/types';
import { orList, type AiSettings, type ProviderId } from '@plugin-sdk/shared';
import type { SummarySettings, SummaryTrigger } from '../shared/settings';
import type { PluginDb, ArchiveReplyReader, CoverageQuery } from '@plugin-sdk/core';
import { privacy } from '@plugin-sdk/core';
import { shownSummary } from './privacy';
import { withPeople } from './people';
import { FILLER_RULES_VERSION } from './filler';
import type { SummaryProviders as ProviderRegistry } from './providers';
import { SUMMARIES_TABLE } from './schema';
import { boundDecider } from '@plugin-sdk/core';
import { summaryJevFingerprint } from './summaryJev';
import { logDigest, readLog } from './summaryLog';
import { PROMPT_VERSION, THEMES_VERSION, mergePrompt, systemPrompt, type PromptOptions } from './summaryPrompt';
import { maxJevQuestions, type RunInput, type RunPlan } from './summaryEstimate';
import { costPerMessage, coveredFrom, insertSummary, summaryPage, summaryUsageSince, toSummary, type NewSummary, type SummaryRow } from './summaryRows';
import { rateComplexity, summaryShapeFingerprint } from './summaryShape';
import { chunkLog, prepareLog, writeSummary, type Progress } from './summaryWrite';

export const NOTHING_NOTABLE ='Nothing notable in this range.';
/** No provider chosen for summaries. */
const NO_PROVIDER = 'No AI provider is chosen for summaries: Settings → Summaries.';
/** #60 model routing picks between OpenRouter models, so it applies only to runs on the OpenRouter provider. */
const ROUTED_PROVIDER = 'openrouter';
/** Providers that may read different channels would be sent different logs. */
const MIXED_READERS =
  'Some of these channels are set to local AI only, so local and hosted models would read different messages. Compare local models only, or hosted ones only.';

/** The range holds no archived messages: nothing to summarize (automatic runs skip quietly). */
export class EmptyRangeError extends Error {
  constructor() {
    super('No archived messages in this range.');
  }
}

/** `settings` with provider `id` set to `model` and `effort`; the rest of its settings (on or off, name) stay. */
export const withModel = (settings: AiSettings, id: ProviderId, model: string | null, effort: string | null): AiSettings => ({
  ...settings,
  providers: { ...settings.providers, [id]: { enabled: true, displayName: null, ...settings.providers[id], model, effort } },
});

export class Summarizer {
  /** Runs go one at a time, so a manual run and an automatic one never interleave their progress. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: PluginDb,
    private readonly payloads: ArchiveReplyReader,
    private readonly providers: ProviderRegistry,
    private readonly emit: (e: AppEvent) => void,
    /** The signed-in user's names, for action items; null until known. */
    private readonly reader: () => string[] | null = () => null,
    /** The plugin activation's lifetime: a run stops between stages once it ends, settling as inactive. */
    readonly lifetime: AbortSignal = new AbortController().signal,
  ) {}

  /** Runs after any run in progress; resolves with the summary as privacy mode shows it. */
  run(req: SummaryRequest, settings: AiSettings, prefs: SummarySettings, trigger: SummaryTrigger): Promise<Summary> {
    const next = this.queue.then(() => this.runNow(req, settings, prefs, trigger));
    this.queue = next.catch(() => undefined);
    return next.then((s) => this.shown(s));
  }

  /** Returns continuous summary coverage for every currently readable requested channel; null if any channel lacks coverage. */
  coveredFrom(q: CoverageQuery, prefs: SummarySettings): number | null {
    const providerId = prefs.defaultProvider;
    const { readable } = this.channels(q.channelIds, providerId);
    return readable.length ? coveredFrom(this.db, readable, q.sinceTs) : null;
  }

  /** The requested channels (null: every archived one) and those a run with `providerId` reads: local-AI-only ones need a local provider (#38). */
  private channels(channelIds: string[] | null | undefined, providerId: ProviderId | null): { requested: string[]; readable: string[] } {
    const requested = channelIds ?? (this.db.prepare('SELECT id FROM archive_all_channels WHERE opted_in = 1').pluck().all() as string[]);
    return { requested, readable: this.providers.permitted(requested, providerId === null ? 'hosted' : { provider: providerId }) };
  }

  /** Estimates maximum Jev questions and model cost; null when the provider or message range is unavailable. */
  estimate(req: SummaryRequest, settings: AiSettings, prefs: SummarySettings): SummaryEstimate | null {
    let p: RunPlan;
    try {
      p = this.plan(req, settings, prefs);
    } catch {
      return null;
    }
    const cached = this.db.prepare(`SELECT 1 FROM ${SUMMARIES_TABLE} WHERE cache_key = ?`).get(p.cacheKey) !== undefined;
    if (cached) return { messages: p.lines.length, cached, questions: 0, modelUsd: null };
    const perMessage = costPerMessage(this.db, p.providerId, p.model);
    return { messages: p.lines.length, cached, questions: maxJevQuestions(p, prefs), modelUsd: perMessage === null ? null : perMessage * p.afterRules.length };
  }

  /** The system prompts a run would send now. Key themes follow the setting; a run including local-only text turns them off. */
  prompts(settings: AiSettings, prefs: SummarySettings): SummaryPrompts {
    const opts = this.promptOptions(prefs, this.providers.decider(settings, 'keyThemes') !== null);
    const now = Date.now();
    return { summarize: systemPrompt(opts, now), merge: mergePrompt(opts, now) };
  }

  private promptOptions(prefs: SummarySettings, themes: boolean): PromptOptions {
    return { length: prefs.length, grouping: prefs.grouping, actionItems: prefs.actionItems, focus: prefs.focus, reader: this.reader(), themes, templates: prefs.prompts };
  }

  /**
   * What every one of `providerIds` reads for `req`: the channels, the log and Jev's steps. Throws when they would read
   * different channels, so a comparison always sends each model the same log.
   */
  input(req: SummaryRequest, settings: AiSettings, prefs: SummarySettings, providerIds: readonly ProviderId[]): RunInput {
    const untilTs = req.untilTs ?? Date.now();
    // Local-AI-only channels: only a local provider may see them; with any other they're left out.
    const [first, ...rest] = providerIds.map((id) => this.channels(req.channelIds, id));
    const { requested, readable: channelIds } = first!;
    if (rest.some((r) => r.readable.length !== channelIds.length || r.readable.some((id) => !channelIds.includes(id)))) throw new Error(MIXED_READERS);
    if (requested.length && !channelIds.length) {
      throw new Error(`These channels are set to local AI only. Summarize them with ${orList(this.providers.localNames()) || 'a local AI provider'}.`);
    }
    const includesLocalOnly = this.providers.permitted(channelIds, 'hosted').length < channelIds.length;

    const lines = readLog(this.db, this.payloads, channelIds, req.sinceTs, untilTs, prefs.grouping, prefs.skipObviousFiller);
    if (!lines.length) throw new EmptyRangeError();
    // Applies rule-based filler filtering before Jev. If all messages are filler, restores the full input.
    const afterRules = prefs.skipObviousFiller && lines.some((l) => !l.filler) ? lines.filter((l) => !l.filler) : lines;

    // Local-only text excludes OpenRouter Jev; every request identifies the run's channels.
    const jevFor = (f: Parameters<ProviderRegistry['decider']>[1]) => {
      const d = includesLocalOnly ? null : this.providers.decider(settings, f);
      return d && boundDecider(d, channelIds);
    };
    const jev: RunInput['jev'] = {
      filter: jevFor('summaryFilter'),
      check: jevFor('citationCheck'),
      quiet: jevFor('skipQuietStretches'),
      chunk: jevFor('conversationChunks'),
      theme: jevFor('keyThemes'),
    };
    return { untilTs, channelIds, lines, afterRules, jev, includesLocalOnly, opts: this.promptOptions(prefs, jev.theme !== null) };
  }

  /** Everything a run is decided by before any model is called: provider, log, Jev steps, prompt options and cache key. */
  private plan(req: SummaryRequest, settings: AiSettings, prefs: SummarySettings): RunPlan {
    const providerId: ProviderId | null = req.provider ?? prefs.defaultProvider;
    if (!providerId) throw new Error(NO_PROVIDER);
    // Throws, naming why, while it can't run or is turned off in Settings → AI; so its choice is stored.
    const provider = this.providers.get(providerId, settings);
    const { model, effort } = settings.providers[providerId]!;
    const input = this.input(req, settings, prefs, [providerId]);
    const { cheapModel, premiumModel, cheapEffort, premiumEffort } = prefs.jevRouting;
    const route = providerId === ROUTED_PROVIDER && cheapModel && premiumModel && !input.includesLocalOnly ? this.providers.decider(settings, 'modelRouting') : null;
    const jev: RunPlan['jev'] = { ...input.jev, route: route && boundDecider(route, input.channelIds) };

    // Enabled, keyed Jev features affect the cache key.
    const jevKey = [
      [jev.filter, jev.check, jev.quiet, jev.chunk, jev.theme].map((j) => j?.model ?? null),
      jev.route ? [jev.route.model, cheapModel, premiumModel, cheapEffort, premiumEffort] : null,
      jev.filter || jev.check ? summaryJevFingerprint() : null,
      jev.quiet || jev.chunk || jev.theme || jev.route ? summaryShapeFingerprint() : null,
      jev.theme ? THEMES_VERSION : null,
    ];
    const fillerKey = prefs.skipObviousFiller ? FILLER_RULES_VERSION : null;
    const cacheKey = createHash('sha256')
      .update(JSON.stringify([PROMPT_VERSION, providerId, model, effort, req.sinceTs, logDigest(input.lines), [...input.channelIds].sort(), jevKey, fillerKey, input.opts]))
      .digest('hex');
    return { ...input, providerId, provider, model, effort, jev, cacheKey };
  }

  private async runNow(req: SummaryRequest, settings: AiSettings, prefs: SummarySettings, trigger: SummaryTrigger): Promise<Summary> {
    this.lifetime.throwIfAborted();
    const progress: Progress = (phase, done, total) => this.emit({ type: 'summary-progress', phase, done, total });
    progress('reading', 0, 0);
    const p = this.plan(req, settings, prefs);
    const cached = this.db.prepare(`SELECT * FROM ${SUMMARIES_TABLE} WHERE cache_key = ?`).get(p.cacheKey);
    if (cached) return toSummary(cached as SummaryRow);
    const { providerId, untilTs, channelIds, lines, opts, cacheKey, jev } = p;
    const { cheapModel, premiumModel, cheapEffort, premiumEffort } = prefs.jevRouting;
    let { provider, model, effort } = p;

    const started = Date.now();
    const { sent, jevCosts } = await prepareLog(p.afterRules, jev, progress, this.lifetime);
    const base = { cacheKey, providerId, req, untilTs, channelIds, sent: sent.length, skipped: lines.length - sent.length, started, trigger, grouping: opts.grouping };
    // #56: a range with nothing notable needs no summary call.
    if (!sent.length) {
      return this.store({ ...base, model, headline: NOTHING_NOTABLE, items: [], actions: [], themes: null, jevCosts, usage: null, apiCostUsd: null, chunkCount: 0 });
    }
    if (jev.route) {
      progress('routing', 0, 0);
      const r = await rateComplexity(jev.route, sent);
      this.lifetime.throwIfAborted();
      if (r.costUsd !== null) jevCosts.push(r.costUsd);
      if (r.complex !== null) {
        model = r.complex ? premiumModel : cheapModel;
        effort = r.complex ? premiumEffort : cheapEffort;
        // The provider picks its key by model, so it is made again for the routed one.
        provider = this.providers.get(providerId, withModel(settings, providerId, model, effort));
      }
    }
    const { chunks, jevCosts: chunkCosts } = await chunkLog(sent, provider.maxInputChars, jev.chunk, this.lifetime);
    const w = await writeSummary({ provider, model, effort, channelIds, lines, sent, chunks, opts, untilTs, jev }, progress, this.lifetime);
    return this.store({ ...base, ...w, model, jevCosts: [...jevCosts, ...chunkCosts, ...w.jevCosts], chunkCount: chunks.length });
  }

  private store(r: NewSummary & { chunkCount: number }): Summary {
    this.lifetime.throwIfAborted();
    const { chunkCount, ...row } = r;
    const summary = insertSummary(this.db, row);
    this.emit({ type: 'summary-progress', phase: 'done', done: chunkCount, total: chunkCount });
    this.emit({ type: 'summary-added', summary: this.shown(summary) });
    return summary;
  }

  /** Summary runs with a provider since a time and the tokens they reported. */
  usageSince(provider: ProviderId, sinceTs: number): AppUsage {
    return summaryUsageSince(this.db, provider, sinceTs);
  }

  /** Summary runs newest first, keyset-paged by (created_at, id), as privacy mode shows them. */
  page(q: SummaryPageQuery): Summary[] {
    const p = privacy(this.db);
    return summaryPage(this.db, q).map((s) => withPeople(this.db, shownSummary(s, p)));
  }

  /** `s` as privacy mode shows it, with its people named as they are now: how every summary leaves core. */
  shown(s: Summary): Summary {
    return withPeople(this.db, shownSummary(s, privacy(this.db)));
  }
}
