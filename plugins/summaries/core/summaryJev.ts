// Jev filler filtering and citation checks.
import type { Citation, CitationCheck } from '../shared/types';
import { errorMessage } from '@plugin-sdk/shared';
import { queryFingerprint, queryMatch, queryRequest } from '@plugin-sdk/core';
import { sumCosts, type DecisionProvider, type Question } from '@plugin-sdk/core';
import { contextBatches } from './summaryRows';

/** Settings → Jev → Queries ids used here. */
const FILLER_QUERY = 'summaries.filler';
const CITATION_QUERY = 'summaries.citation';
/** Identifies these queries as currently edited: cached summaries made with other versions are not reused. */
export const summaryJevFingerprint = (): string => queryFingerprint([FILLER_QUERY, CITATION_QUERY]);

/** One message as the summarizer sees it. */
export interface LogLine {
  ref: string;
  citation: Citation;
  /** What the LLM reads: ref, channel, time, author, text. */
  text: string;
  /** What Jev reads: author and text only; refs and times are noise for its judgments. */
  plain: string;
  /** Matches the rule-based filler check (filler.ts); used only when that setting is on. */
  filler: boolean;
}

/** Messages judged per request. They share one state, which Jev bills once per request (TypeSafe "parallel questions"). */
const TARGETS_PER_REQUEST = 20;
/**
 * Neighbours on each side of a batch, so a reply at a batch edge is read with what it answers.
 * State stays ≤ 26 clipped messages (~5k tokens), small enough to avoid Jev's accuracy loss on large states.
 */
const CONTEXT_LINES = 3;

/** The filler query about line k; its condition says when a line is kept (default: unless Jev is 80% sure it's filler). */
const needed = (k: number): Question => queryRequest(FILLER_QUERY, { placeholders: { '{k}': String(k) } });

/** Questions skipFiller and checkCitations ask, for a run's cost projection. */
export const JEV_FILTER_CHECK_QUESTIONS = {
  /** One per message. */
  filter: (lines: LogLine[]): number => lines.length,
  /** One per summary bullet. */
  check: (bullets: number): number => bullets,
};

export interface FilterResult {
  kept: LogLine[];
  skipped: number;
  costUsd: number | null;
}

/**
 * Leaves out messages Jev is confident are filler. Fails open: a failed request or a missing answer keeps
 * the message. Each channel is judged on its own, so context never mixes channels.
 */
export async function skipFiller(jev: DecisionProvider, lines: LogLine[], progress: (done: number, total: number) => void): Promise<FilterResult> {
  const batches = contextBatches(lines, TARGETS_PER_REQUEST, CONTEXT_LINES);
  const drop = new Set<string>();
  const costs: number[] = [];
  let done = 0;
  progress(done, batches.length);
  await Promise.all(
    batches.map(async (b) => {
      const questions: Record<string, Question> = {};
      for (let k = b.first; k < b.first + b.count; k++) questions[`q${k}`] = needed(k);
      try {
        const r = await jev.decide({ state: { conversation: b.conversation.map((l) => l.plain) }, questions });
        if (r.costUsd !== null) costs.push(r.costUsd);
        for (let k = b.first; k < b.first + b.count; k++) {
          const a = r.answers[`q${k}`];
          if (a && queryMatch(FILLER_QUERY, a) === null) drop.add(b.conversation[k]!.ref);
        }
      } catch (err) {
        console.warn('[summary] Jev filter batch failed; keeping its messages:', errorMessage(err));
      }
      progress(++done, batches.length);
    }),
  );
  const kept = lines.filter((l) => !drop.has(l.ref));
  // Nothing left to summarize: let the LLM see everything rather than fail.
  if (!kept.length) return { kept: lines, skipped: 0, costUsd: sumCosts(costs) };
  return { kept, skipped: lines.length - kept.length, costUsd: sumCosts(costs) };
}

const VERDICT: Record<string, CitationCheck['verdict']> = { supports: 'supported', contradicts: 'contradicted', says_nothing: 'unsupported' };

export interface CheckResult {
  /** Per item, in order; undefined where the request failed. */
  checks: (CitationCheck | undefined)[];
  costUsd: number | null;
}

/**
 * Checks each summary bullet against the messages it cites (TypeSafe's citation-check pattern).
 * Only annotates; nothing is removed. `log` is the full chronological log, used for each citation's preceding message.
 */
export async function checkCitations(jev: DecisionProvider, items: { text: string; refs: string[] }[], log: LogLine[]): Promise<CheckResult> {
  const index = new Map(log.map((l, i) => [l.ref, i]));
  /** The same channel's message just before log[i]. */
  const previous = (i: number): LogLine | undefined => {
    for (let j = i - 1; j >= 0; j--) if (log[j]!.citation.channelId === log[i]!.citation.channelId) return log[j];
    return undefined;
  };
  const costs: number[] = [];
  const checks = await Promise.all(
    items.map(async (item): Promise<CitationCheck | undefined> => {
      const at = [...new Set(item.refs.map((r) => index.get(r.trim())).filter((i): i is number => i !== undefined))].sort((a, b) => a - b);
      if (!at.length) return { verdict: 'uncited', confidence: null };
      const cited = new Set(at.map((i) => log[i]!.ref));
      const context = at.map(previous).filter((l): l is LogLine => l !== undefined && !cited.has(l.ref));
      try {
        const r = await jev.decide({
          state: { claim: item.text, cited_messages: at.map((i) => log[i]!.plain), context: [...new Set(context)].map((l) => l.plain) },
          questions: { relation: queryRequest(CITATION_QUERY) },
        });
        if (r.costUsd !== null) costs.push(r.costUsd);
        const a = r.answers.relation;
        return a?.type === 'choice' && VERDICT[a.choice] ? { verdict: VERDICT[a.choice]!, confidence: a.confidence } : undefined;
      } catch (err) {
        console.warn('[summary] Jev citation check failed:', errorMessage(err));
        return undefined;
      }
    }),
  );
  return { checks, costUsd: sumCosts(costs) };
}
