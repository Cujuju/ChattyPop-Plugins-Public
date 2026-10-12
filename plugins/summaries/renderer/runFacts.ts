// What a run read, took, used and cost, as labelled facts under its headline.
import { MS_PER_MIN, MS_PER_S } from '@plugin-sdk/shared';
import type { Summary } from '../shared/types';

/** One fact about a run. `strong`: what it cost, the figure a reader looks for. `title`: the fine print, on hover. */
export interface RunFact {
  label: string;
  value: string;
  strong?: true;
  title?: string;
}

/** How a fact's figures are written: a run's provider, its token counts and its dollars. */
export interface FactText {
  provider: string;
  tokens(n: number): string;
  usd(n: number): string;
}

/** "42 s", or "2 m 7 s" from a minute up. */
export function durationText(ms: number): string {
  const s = Math.round(ms / MS_PER_S);
  const perMin = MS_PER_MIN / MS_PER_S;
  return s < perMin ? `${s} s` : `${Math.floor(s / perMin)} m ${s % perMin} s`;
}

/** A run's facts, the figures first; one that called no model has neither tokens nor a cost to report. */
export function runFacts(s: Summary, text: FactText): RunFact[] {
  const u = s.usage;
  const called = s.messageCount > 0;
  return [
    {
      label: 'Messages',
      value: s.skippedCount > 0 ? `${s.messageCount} · ${s.skippedCount} skipped` : String(s.messageCount),
      ...(s.skippedCount > 0 && { title: `Jev left out ${s.skippedCount} as filler.` }),
    },
    { label: 'Took', value: durationText(s.durationMs) },
    ...(u
      ? [{ label: 'Tokens', value: `${text.tokens(u.inputTokens)} in${u.cachedInputTokens ? ` (${text.tokens(u.cachedInputTokens)} cached)` : ''} · ${text.tokens(u.outputTokens)} out` }]
      : called ? [{ label: 'Tokens', value: 'not reported' }] : []),
    ...(s.apiCostUsd !== null
      ? [{ label: 'API cost', value: `≈${text.usd(s.apiCostUsd)}`, strong: true as const, title: `What the run costs at the model's API rates${s.apiCostEstimated ? ', estimated from its tokens' : ''}.` }]
      : called ? [{ label: 'API cost', value: 'unknown' }] : []),
    ...(s.jevCostUsd !== null ? [{ label: 'Jev', value: text.usd(s.jevCostUsd), title: "Jev's filter, citation check and themes." }] : []),
    // Last: the longest value, so it takes the row left over, or its own on a narrow panel.
    { label: 'Model', value: s.model ? `${text.provider} · ${s.model}` : text.provider },
  ];
}
