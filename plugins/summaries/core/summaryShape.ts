// Jev shaping a summary run: skip quiet stretches (#56), cut long runs between conversations (#58), sort messages into
// key themes (#59) and pick the cheap or premium model (#60). Every step fails open to the plain behaviour.
import type { Citation } from '../shared/types';
import { errorMessage } from '@plugin-sdk/shared';
import { queryFingerprint, queryMatch, queryRequest, queryStrength } from '@plugin-sdk/core';
import { sumCosts, type DecisionProvider, type Question } from '@plugin-sdk/core';
import type { LogLine } from './summaryJev';
import { byChannel, contextBatches } from './summaryRows';

/** Settings → Jev → Queries ids used here. */
const QUERY = { quiet: 'summaries.quiet', boundary: 'summaries.boundary', themes: 'summaries.themes', complexity: 'summaries.complexity' } as const;
/** Identifies these queries as currently edited: cached summaries made with other versions are not reused. */
export const summaryShapeFingerprint = (): string => queryFingerprint(Object.values(QUERY));

/** #56: lines per quiet-check window; small enough to stay a focused state, large enough that a window is a stretch. */
const QUIET_WINDOW = 30;
/** #58: how far back from the size limit a cut may move, in lines; keeps every chunk at least mostly full. */
const BOUNDARY_WINDOW = 12;
/** #59: messages per theme request (shared state, one choice each) and neighbours on each side for context. */
const THEME_TARGETS = 20;
const THEME_CONTEXT = 3;
const NO_THEME = 'none';
/** #60: lines sampled from each end of the run to judge its complexity. */
const ROUTING_SAMPLE = 40;

const quietWindows = (lines: LogLine[]): LogLine[][] =>
  byChannel(lines).flatMap((seq) => Array.from({ length: Math.ceil(seq.length / QUIET_WINDOW) }, (_, i) => seq.slice(i * QUIET_WINDOW, (i + 1) * QUIET_WINDOW)));

/** Questions each step asks, for a run's cost projection: kept next to the steps so the two can't drift apart. */
export const JEV_STEP_QUESTIONS = {
  /** #56: one per window. */
  quiet: (lines: LogLine[]): number => quietWindows(lines).length,
  /** #58: at most one per candidate line at each cut. */
  chunk: (cuts: number): number => cuts * (BOUNDARY_WINDOW + 1),
  /** #59: one per message. */
  themes: (lines: LogLine[]): number => lines.length,
  /** #60: one for the run. */
  route: 1,
};

/** #56: drops per-channel stretches that don't meet the quiet query's keep condition. Returns the kept lines (possibly none). */
export async function skipQuiet(jev: DecisionProvider, lines: LogLine[]): Promise<{ kept: LogLine[]; costUsd: number | null }> {
  const windows = quietWindows(lines);
  const costs: number[] = [];
  const drop = new Set<string>();
  await Promise.all(
    windows.map(async (w) => {
      try {
        const r = await jev.decide({ state: { conversation: w.map((l) => l.plain) }, questions: { quiet: queryRequest(QUERY.quiet) } });
        if (r.costUsd !== null) costs.push(r.costUsd);
        const a = r.answers.quiet;
        if (a && queryMatch(QUERY.quiet, a) === null) for (const l of w) drop.add(l.ref);
      } catch (err) {
        console.warn('[summary] Jev quiet check failed; keeping the stretch:', errorMessage(err));
      }
    }),
  );
  return { kept: lines.filter((l) => !drop.has(l.ref)), costUsd: sumCosts(costs) };
}

const CONTINUES = (previous: string, next: string): Question => queryRequest(QUERY.boundary, { vars: { previous, next } });

/**
 * #58: splits the log into chunks under `maxChars`, moving each cut back (within BOUNDARY_WINDOW lines) to where Jev
 * finds the conversation least continuous. A failed request keeps the plain size cut.
 */
export async function chunkByConversation(jev: DecisionProvider, lines: LogLine[], maxChars: number): Promise<{ chunks: LogLine[][]; costUsd: number | null }> {
  const chunks: LogLine[][] = [];
  const costs: number[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let size = 0;
    while (end < lines.length && (end === start || size + lines[end]!.text.length <= maxChars)) size += lines[end++]!.text.length + 1;
    if (end < lines.length) {
      const from = Math.max(start + 1, end - BOUNDARY_WINDOW);
      const questions: Record<string, Question> = {};
      for (let i = from; i <= end; i++) questions[`c${i}`] = CONTINUES(lines[i - 1]!.text, lines[i]!.text);
      try {
        const r = await jev.decide({ state: { note: 'Chat lines from one Discord log, in order.' }, questions });
        if (r.costUsd !== null) costs.push(r.costUsd);
        let best = end;
        let bestP = Number.POSITIVE_INFINITY;
        for (let i = from; i <= end; i++) {
          const a = r.answers[`c${i}`];
          const p = a ? queryStrength(QUERY.boundary, a) : null;
          if (p !== null && p < bestP) [best, bestP] = [i, p];
        }
        end = best;
      } catch (err) {
        console.warn('[summary] Jev conversation boundary failed; cutting by size:', errorMessage(err));
      }
    }
    chunks.push(lines.slice(start, end));
    start = end;
  }
  return { chunks, costUsd: sumCosts(costs) };
}

/** A theme as the LLM names it: the description is what Jev reads as the option's meaning (Jev reads literally). */
export interface ThemeDraft {
  title: string;
  description: string;
}

/** #59: sorts each line under one of the LLM's themes (or none), in per-channel batches with neighbours as context. */
export async function assignThemes(jev: DecisionProvider, lines: LogLine[], themes: ThemeDraft[]): Promise<{ themes: { title: string; citations: Citation[] }[]; costUsd: number | null }> {
  const described = new Map<string, string>();
  for (const t of themes) {
    const title = t.title.trim();
    if (title && title !== NO_THEME && !described.has(title)) described.set(title, t.description.trim());
  }
  const titles = [...described.keys()];
  if (!titles.length) return { themes: [], costUsd: null };
  const options = [...titles.map((t) => ({ name: t, description: described.get(t) ?? '' })), { name: NO_THEME, description: 'None of the themes, or small talk.' }];
  const members = new Map<string, Citation[]>(titles.map((t) => [t, []]));
  const costs: number[] = [];
  const batches = contextBatches(lines, THEME_TARGETS, THEME_CONTEXT);
  await Promise.all(
    batches.map(async (b) => {
      const questions: Record<string, Question> = {};
      for (let k = b.first; k < b.first + b.count; k++) questions[`q${k}`] = queryRequest(QUERY.themes, { placeholders: { '{k}': String(k) }, options });
      try {
        const r = await jev.decide({ state: { conversation: b.conversation.map((l) => l.plain) }, questions });
        if (r.costUsd !== null) costs.push(r.costUsd);
        for (let k = b.first; k < b.first + b.count; k++) {
          const a = r.answers[`q${k}`];
          if (a?.type === 'choice' && queryMatch(QUERY.themes, a, titles) !== null) members.get(a.choice)?.push(b.conversation[k]!.citation);
        }
      } catch (err) {
        console.warn('[summary] Jev theme sorting failed for a batch:', errorMessage(err));
      }
    }),
  );
  const out = titles.map((title) => ({ title, citations: members.get(title)!.sort((a, b) => a.ts - b.ts) }));
  return { themes: out, costUsd: sumCosts(costs) };
}

/** #60: whether a sample from both ends of the run meets the complexity query's condition; null when Jev fails. */
export async function rateComplexity(jev: DecisionProvider, lines: LogLine[]): Promise<{ complex: boolean | null; costUsd: number | null }> {
  const sample = lines.length <= 2 * ROUTING_SAMPLE ? lines : [...lines.slice(0, ROUTING_SAMPLE), ...lines.slice(-ROUTING_SAMPLE)];
  try {
    const r = await jev.decide({ state: { conversation: sample.map((l) => l.plain) }, questions: { complexity: queryRequest(QUERY.complexity) } });
    const a = r.answers.complexity;
    return { complex: a ? queryMatch(QUERY.complexity, a) !== null : null, costUsd: r.costUsd };
  } catch (err) {
    console.warn('[summary] Jev complexity failed; using the configured model:', errorMessage(err));
    return { complex: null, costUsd: null };
  }
}
