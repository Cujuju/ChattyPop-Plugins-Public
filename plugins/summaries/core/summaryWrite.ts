// The stages of a summary run around its model calls: preparing the log once, and writing it with one model.
import type { TokenUsage } from '@plugin-sdk/shared';
import type { DecisionProvider, PluginCompletionRequest, PluginProvider } from '@plugin-sdk/core';
import { chosenModel, sumCosts } from '@plugin-sdk/core';
import type { Citation, SummaryItem, SummaryPart, SummaryProgress, SummaryTheme } from '../shared/types';
import { checkCitations, skipFiller, type LogLine } from './summaryJev';
import { linkMarked, peopleByName, peopleByTag, unmarked } from './people';
import { mergePrompt, partialText, schemaFor, systemPrompt, wholePoint, type Draft, type DraftPart, type PromptOptions } from './summaryPrompt';
import { assignThemes, chunkByConversation, skipQuiet } from './summaryShape';
import { chunk, sumUsage } from './summaryRows';

/** Reports a stage of a run. */
export type Progress = (phase: SummaryProgress['phase'], done: number, total: number) => void;

/** Jev's cost of one step, kept when reported. */
const costOf = (costs: number[], c: number | null): void => void (c !== null && costs.push(c));

/** The log after Jev's filler and quiet-stretch steps, with what they cost. */
export async function prepareLog(
  afterRules: LogLine[],
  jev: { filter: DecisionProvider | null; quiet: DecisionProvider | null },
  progress: Progress,
  signal: AbortSignal,
): Promise<{ sent: LogLine[]; jevCosts: number[] }> {
  const jevCosts: number[] = [];
  let sent = afterRules;
  if (jev.filter) {
    const f = await skipFiller(jev.filter, sent, (done, total) => progress('filtering', done, total));
    signal.throwIfAborted();
    sent = f.kept;
    costOf(jevCosts, f.costUsd);
  }
  if (jev.quiet) {
    progress('quiet', 0, 0);
    const q = await skipQuiet(jev.quiet, sent);
    signal.throwIfAborted();
    costOf(jevCosts, q.costUsd);
    sent = q.kept;
  }
  return { sent, jevCosts };
}

/** The log in parts under `maxChars`, cut between conversations when Jev's step is on. */
export async function chunkLog(sent: LogLine[], maxChars: number, chunkJev: DecisionProvider | null, signal: AbortSignal): Promise<{ chunks: LogLine[][]; jevCosts: number[] }> {
  const chunks = chunk(sent, maxChars);
  if (!chunkJev || chunks.length < 2) return { chunks, jevCosts: [] };
  const c = await chunkByConversation(chunkJev, sent, maxChars);
  signal.throwIfAborted();
  return { chunks: c.chunks, jevCosts: c.costUsd === null ? [] : [c.costUsd] };
}

/** What one model wrote from the prepared log, linked, checked and themed. */
export interface Written {
  headline: string;
  items: SummaryItem[];
  actions: SummaryItem[];
  themes: SummaryTheme[] | null;
  /** Summed over every call; null when no call reported usage. */
  usage: TokenUsage | null;
  /** Null when any call's cost is unknown (a partial sum would understate it). */
  apiCostUsd: number | null;
  jevCosts: number[];
}

export interface WriteInput {
  provider: PluginProvider;
  model: string | null;
  effort: string | null;
  channelIds: string[];
  /** The whole log, for refs, citations and people. */
  lines: LogLine[];
  /** The log the model reads, for key themes. */
  sent: LogLine[];
  chunks: LogLine[][];
  opts: PromptOptions;
  untilTs: number;
  jev: { check: DecisionProvider | null; theme: DecisionProvider | null };
}

/** A request as it reaches a provider, before the model and thinking level are added. */
export type SentRequest = Omit<PluginCompletionRequest, 'model' | 'effort'>;

/** The requests that summarize each part of the log, in order: the same for every model given the same parts. */
export const partRequests = (w: Pick<WriteInput, 'chunks' | 'opts' | 'untilTs' | 'channelIds'>): SentRequest[] =>
  w.chunks.map((c) => ({ system: systemPrompt(w.opts, w.untilTs), prompt: c.map((l) => l.text).join('\n'), schema: schemaFor(w.opts), reads: w.channelIds }));

/** Summarizes each part, merges the parts, then links people and runs Jev's citation check and key themes. `onSend` sees each request first. */
export async function writeSummary(
  w: WriteInput,
  progress: Progress,
  signal: AbortSignal,
  onSend: (stage: 'part' | 'merge', req: SentRequest) => void = () => undefined,
): Promise<Written> {
  const { provider, channelIds, lines, chunks, opts, untilTs } = w;
  const jevCosts: number[] = [];
  const callUsage: TokenUsage[] = [];
  const callCosts: (number | undefined)[] = [];
  const complete = async (stage: 'part' | 'merge', req: SentRequest): Promise<Draft> => {
    onSend(stage, req);
    const r = await provider.complete({ ...req, ...chosenModel({ model: w.model, effort: w.effort }) });
    signal.throwIfAborted();
    if (r.usage) callUsage.push(r.usage);
    callCosts.push(r.apiCostUsd);
    return r.json as Draft;
  };

  const drafts: Draft[] = [];
  for (const [i, req] of partRequests(w).entries()) {
    progress('summarizing', i, chunks.length);
    drafts.push(await complete('part', req));
  }
  const byRef = new Map(lines.map((l) => [l.ref, l.citation]));
  let final = drafts[0]!;
  if (drafts.length > 1) {
    progress('merging', chunks.length, chunks.length);
    const partials = drafts.map((d, i) => partialText(d, i + 1, (ref) => byRef.get(ref)?.channelName, opts.grouping));
    final = await complete('merge', { system: mergePrompt(opts, untilTs), prompt: partials.join('\n\n'), schema: schemaFor(opts), reads: channelIds });
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
  if (w.jev.check) {
    progress('checking', chunks.length, chunks.length);
    const c = await checkCitations(w.jev.check, final.items.map((p) => { const whole = wholePoint(p); return { ...whole, text: unmarked(whole.text, byTag) }; }), lines);
    signal.throwIfAborted();
    c.checks.forEach((check, i) => {
      if (check) items[i]!.check = check;
    });
    costOf(jevCosts, c.costUsd);
  }
  let themes: SummaryTheme[] | null = null;
  if (w.jev.theme && final.themes?.length) {
    progress('themes', chunks.length, chunks.length);
    const t = await assignThemes(w.jev.theme, w.sent, final.themes);
    signal.throwIfAborted();
    costOf(jevCosts, t.costUsd);
    themes = t.themes.map((x) => ({ ...x, title: link(x.title) }));
  }
  const knownCosts = callCosts.filter((c): c is number => c !== undefined);
  return {
    headline: link(final.headline),
    items,
    actions,
    themes,
    usage: callUsage.length ? sumUsage(callUsage) : null,
    apiCostUsd: knownCosts.length === callCosts.length ? sumCosts(knownCosts) : null,
    jevCosts,
  };
}
