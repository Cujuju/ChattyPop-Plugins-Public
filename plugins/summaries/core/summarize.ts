// Queued summary generation, caching and progress.
import { createHash } from 'node:crypto';
import type { Citation, Summary, SummaryItem, SummaryEstimate, SummaryPageQuery, SummaryPart, SummaryPrompts, SummaryRequest, SummaryTheme } from '../shared/types';
import type { AppUsage, TokenUsage } from '@plugin-sdk/shared';
import type { SummaryEvent as AppEvent } from '../shared/types';
import { orList, type AiSettings, type ProviderId } from '@plugin-sdk/shared';
import type { SummarySettings, SummaryTrigger } from '../shared/settings';
import type { PluginDb, ArchiveReplyReader, CoverageQuery } from '@plugin-sdk/core';
import { privacy } from '@plugin-sdk/core';
import { shownSummary } from './privacy';
import { linkMarked, peopleByName, peopleByTag, unmarked, withPeople } from './people';
import { FILLER_RULES_VERSION } from './filler';
import type { SummaryProviders as ProviderRegistry } from './providers';
import { SUMMARIES_TABLE } from './schema';
import { boundDecider, chosenModel, sumCosts } from '@plugin-sdk/core';
import { checkCitations, skipFiller, summaryJevFingerprint } from './summaryJev';
import { logDigest, readLog } from './summaryLog';
import { PROMPT_VERSION, THEMES_VERSION, mergePrompt, partialText, schemaFor, systemPrompt, wholePoint, type Draft, type DraftPart, type PromptOptions } from './summaryPrompt';
import { maxJevQuestions, type RunPlan } from './summaryEstimate';
import { chunk, costPerMessage, coveredFrom, insertSummary, sumUsage, summaryPage, summaryUsageSince, toSummary, type NewSummary, type SummaryRow } from './summaryRows';
import { assignThemes, chunkByConversation, rateComplexity, skipQuiet, summaryShapeFingerprint } from './summaryShape';

const NOTHING_NOTABLE = 'Nothing notable in this range.';
/** No provider chosen for summaries. */
const NO_PROVIDER = 'No AI provider is chosen for summaries: Settings → Summaries.';
/** #60 model routing picks between OpenRouter models, so it applies only to runs on the OpenRouter provider. */
const ROUTED_PROVIDER = 'openrouter';

/** The range holds no archived messages: nothing to summarize (automatic runs skip quietly). */
export class EmptyRangeError extends Error {
  constructor() {
    super('No archived messages in this range.');
  }
}

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
    private readonly lifetime: AbortSignal = new AbortController().signal,
  ) {}

  /** Runs after any run in progress; resolves with the summary as privacy mode shows it. */
  run(req: SummaryRequest, settings: AiSettings, prefs: SummarySettings, trigger: SummaryTrigger): Promise<Summary> {
    const next = this.queue.then(() => this.runNow(req, settings, prefs, trigger));
    this.queue = next.catch(() => undefined);
    return next.then((s) => this.shown(s));
  }

  /**
   * Where stored runs cover, without a gap from `q.sinceTs`, every channel a run over `q.channelIds` with Summaries'
   * provider would read now; null when some channel isn't covered there.
   */
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

  /** What a run would cost: Jev's most questions and the model's likely cost; null when it can't run (no provider, empty range). */
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

  /** Everything a run is decided by before any model is called: provider, log, Jev steps, prompt options and cache key. */
  private plan(req: SummaryRequest, settings: AiSettings, prefs: SummarySettings): RunPlan {
    const providerId: ProviderId | null = req.provider ?? prefs.defaultProvider;
    if (!providerId) throw new Error(NO_PROVIDER);
    // Throws, naming why, while it can't run or is turned off in Settings → AI; so its choice is stored.
    const provider = this.providers.get(providerId, settings);
    const { model, effort } = settings.providers[providerId]!;
    const untilTs = req.untilTs ?? Date.now();
    // Local-AI-only channels: only a local provider may see them; with any other they're left out.
    const { requested, readable: channelIds } = this.channels(req.channelIds, providerId);
    if (requested.length && !channelIds.length) {
      throw new Error(`These channels are set to local AI only. Summarize them with ${orList(this.providers.localNames()) || 'a local AI provider'}.`);
    }
    const includesLocalOnly = this.providers.permitted(channelIds, 'hosted').length < channelIds.length;

    const lines = readLog(this.db, this.payloads, channelIds, req.sinceTs, untilTs, prefs.grouping, prefs.skipObviousFiller);
    if (!lines.length) throw new EmptyRangeError();
    // Rules first, so Jev isn't paid to judge obvious filler. If everything is filler, the LLM sees everything rather than fail.
    const afterRules = prefs.skipObviousFiller && lines.some((l) => !l.filler) ? lines.filter((l) => !l.filler) : lines;

    // Jev features the user turned on (and a key is stored); each changes the result, so each is part of the cache key.
    // Jev runs on OpenRouter: never on a run that includes local-only text. Every Jev request reads the run's channels.
    const jevFor = (f: Parameters<ProviderRegistry['decider']>[1]) => {
      const d = includesLocalOnly ? null : this.providers.decider(settings, f);
      return d && boundDecider(d, channelIds);
    };
    const { cheapModel, premiumModel, cheapEffort, premiumEffort } = prefs.jevRouting;
    const jev: RunPlan['jev'] = {
      filter: jevFor('summaryFilter'),
      check: jevFor('citationCheck'),
      quiet: jevFor('skipQuietStretches'),
      chunk: jevFor('conversationChunks'),
      theme: jevFor('keyThemes'),
      route: providerId === ROUTED_PROVIDER && cheapModel && premiumModel ? jevFor('modelRouting') : null,
    };
    const jevKey = [
      [jev.filter, jev.check, jev.quiet, jev.chunk, jev.theme].map((j) => j?.model ?? null),
      jev.route ? [jev.route.model, cheapModel, premiumModel, cheapEffort, premiumEffort] : null,
      jev.filter || jev.check ? summaryJevFingerprint() : null,
      jev.quiet || jev.chunk || jev.theme || jev.route ? summaryShapeFingerprint() : null,
      jev.theme ? THEMES_VERSION : null,
    ];
    const fillerKey = prefs.skipObviousFiller ? FILLER_RULES_VERSION : null;
    const opts = this.promptOptions(prefs, jev.theme !== null);
    const cacheKey = createHash('sha256')
      .update(JSON.stringify([PROMPT_VERSION, providerId, model, effort, req.sinceTs, logDigest(lines), [...channelIds].sort(), jevKey, fillerKey, opts]))
      .digest('hex');
    return { providerId, provider, model, effort, untilTs, channelIds, lines, afterRules, jev, opts, cacheKey };
  }

  private async runNow(req: SummaryRequest, settings: AiSettings, prefs: SummarySettings, trigger: SummaryTrigger): Promise<Summary> {
    this.lifetime.throwIfAborted();
    this.emit({ type: 'summary-progress', phase: 'reading', done: 0, total: 0 });
    const p = this.plan(req, settings, prefs);
    const cached = this.db.prepare(`SELECT * FROM ${SUMMARIES_TABLE} WHERE cache_key = ?`).get(p.cacheKey);
    if (cached) return toSummary(cached as SummaryRow);
    const { providerId, untilTs, channelIds, lines, opts, cacheKey } = p;
    const { filter: filterJev, check: checkJev, quiet: quietJev, chunk: chunkJev, theme: themeJev, route: routeJev } = p.jev;
    const { cheapModel, premiumModel, cheapEffort, premiumEffort } = prefs.jevRouting;
    let { provider, model, effort } = p;

    const started = Date.now();
    const jevCosts: number[] = [];
    const cost = (c: number | null): void => void (c !== null && jevCosts.push(c));
    let sent = p.afterRules;
    if (filterJev) {
      const f = await skipFiller(filterJev, sent, (done, total) => this.emit({ type: 'summary-progress', phase: 'filtering', done, total }));
      this.lifetime.throwIfAborted();
      sent = f.kept;
      cost(f.costUsd);
    }
    if (quietJev) {
      this.emit({ type: 'summary-progress', phase: 'quiet', done: 0, total: 0 });
      const q = await skipQuiet(quietJev, sent);
      this.lifetime.throwIfAborted();
      cost(q.costUsd);
      sent = q.kept;
    }
    const callUsage: TokenUsage[] = [];
    const callCosts: (number | undefined)[] = [];
    const knownCosts = (): number[] => callCosts.filter((c): c is number => c !== undefined);
    const store = (headline: string, items: SummaryItem[], actions: SummaryItem[], themes: SummaryTheme[] | null, chunkCount: number): Summary =>
      this.store({
        cacheKey, providerId, model, req, untilTs, channelIds, sent: sent.length, skipped: lines.length - sent.length, started,
        headline, items, actions, jevCosts, themes, chunkCount, trigger, grouping: opts.grouping,
        // Summed over every call; null when no call reported usage, or any call's cost is unknown (a partial sum would understate it).
        usage: callUsage.length ? sumUsage(callUsage) : null,
        apiCostUsd: knownCosts().length === callCosts.length ? sumCosts(knownCosts()) : null,
      });
    // #56: a range with nothing notable needs no summary call.
    if (!sent.length) return store(NOTHING_NOTABLE, [], [], null, 0);
    if (routeJev) {
      this.emit({ type: 'summary-progress', phase: 'routing', done: 0, total: 0 });
      const r = await rateComplexity(routeJev, sent);
      this.lifetime.throwIfAborted();
      cost(r.costUsd);
      if (r.complex !== null) {
        model = r.complex ? premiumModel : cheapModel;
        effort = r.complex ? premiumEffort : cheapEffort;
        // The provider picks its key by model, so it is made again for the routed one.
        const routed = { enabled: true, displayName: null, model, effort };
        provider = this.providers.get(providerId, { ...settings, providers: { ...settings.providers, [providerId]: routed } });
      }
    }
    let chunks = chunk(sent, provider.maxInputChars);
    if (chunkJev && chunks.length > 1) {
      const c = await chunkByConversation(chunkJev, sent, provider.maxInputChars);
      this.lifetime.throwIfAborted();
      cost(c.costUsd);
      chunks = c.chunks;
    }
    const schema = schemaFor(opts);
    const complete = async (system: string, prompt: string): Promise<Draft> => {
      const r = await provider.complete({ system, prompt, schema, ...chosenModel({ model, effort }), reads: channelIds });
      this.lifetime.throwIfAborted();
      if (r.usage) callUsage.push(r.usage);
      callCosts.push(r.apiCostUsd);
      return r.json as Draft;
    };

    const drafts: Draft[] = [];
    for (const [i, c] of chunks.entries()) {
      this.emit({ type: 'summary-progress', phase: 'summarizing', done: i, total: chunks.length });
      drafts.push(await complete(systemPrompt(opts, untilTs), c.map((l) => l.text).join('\n')));
    }
    const byRef = new Map(lines.map((l) => [l.ref, l.citation]));
    let final = drafts[0]!;
    if (drafts.length > 1) {
      this.emit({ type: 'summary-progress', phase: 'merging', done: chunks.length, total: chunks.length });
      const partials = drafts.map((d, i) => partialText(d, i + 1, (ref) => byRef.get(ref)?.channelName, opts.grouping));
      final = await complete(mergePrompt(opts, untilTs), partials.join('\n\n'));
    }

    // The people the model read, by the tags it writes (or a name, from an owner's template written before tags).
    const people = lines.flatMap((l) => l.people);
    const byTag = peopleByTag(people);
    const byName = peopleByName(people.map((p) => [p.name, p.userId] as const));
    const link = (text: string): string => linkMarked(text, byTag, byName);
    const cited = (p: DraftPart): SummaryPart => ({
      text: link(p.text),
      citations: p.refs.map((r) => byRef.get(r.trim())).filter((c): c is Citation => c !== undefined),
    });
    const items = final.items.map((p): SummaryItem => ({ parts: p.parts.map(cited) }));
    const actions = opts.actionItems ? (final.actions ?? []).map((a): SummaryItem => ({ parts: [cited(a)] })) : [];
    if (checkJev) {
      this.emit({ type: 'summary-progress', phase: 'checking', done: chunks.length, total: chunks.length });
      const c = await checkCitations(checkJev, final.items.map((p) => { const w = wholePoint(p); return { ...w, text: unmarked(w.text, byTag) }; }), lines);
      this.lifetime.throwIfAborted();
      c.checks.forEach((check, i) => {
        if (check) items[i]!.check = check;
      });
      cost(c.costUsd);
    }
    let themes: SummaryTheme[] | null = null;
    if (themeJev && final.themes?.length) {
      this.emit({ type: 'summary-progress', phase: 'themes', done: chunks.length, total: chunks.length });
      const t = await assignThemes(themeJev, sent, final.themes);
      this.lifetime.throwIfAborted();
      cost(t.costUsd);
      themes = t.themes.map((x) => ({ ...x, title: link(x.title) }));
    }
    return store(link(final.headline), items, actions, themes, chunks.length);
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
  private shown(s: Summary): Summary {
    return withPeople(this.db, shownSummary(s, privacy(this.db)));
  }
}
