// Summary action declaration with stable stored identity.
import { MS_PER_HOUR } from '@plugin-sdk/shared';
import { SUMMARY_PROMPT_KINDS, summaryPromptError } from './prompts';
import { AFTER_MESSAGE, defineRuleAction } from '@plugin-sdk/shared';
import { SUMMARY_RANGES, summaryRuleOptionsError, type SummaryRange, type SummaryRuleOptions } from './settings';

/** Time frames a timed rule may read in place of its window; Last visit and Last run are what that window already is. */
export const RULE_SUMMARY_RANGES = ['today', 'yesterday', '30m', '1h', '3h', '6h', '12h', '24h', '3d', '7d', '30d'] as const satisfies readonly SummaryRange[];
export type RuleSummaryRange = (typeof RULE_SUMMARY_RANGES)[number];

/** A message rule's lookback, a timed rule's time frame, and the rule's own options. */
export interface SummarizeConfig extends SummaryRuleOptions {
  lookbackMs: number;
  /** Timed rules: the time frame, ending when the window does; absent = the window (since its last run). */
  range?: RuleSummaryRange;
}

/** Local midnight `days` calendar days before `ts`'s (by the calendar, so a clock change doesn't shift it). */
function midnightBefore(ts: number, days: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

/** The span a time frame reads, ending at `untilTs`: Today from its midnight, Yesterday the whole local day before. */
export function ruleRangeSpan(range: RuleSummaryRange, untilTs: number): { sinceTs: number; untilTs: number } {
  const ms = SUMMARY_RANGES[range].ms;
  if (ms !== null) return { sinceTs: untilTs - ms, untilTs };
  if (range === 'today') return { sinceTs: midnightBefore(untilTs, 0), untilTs };
  return { sinceTs: midnightBefore(untilTs, 1), untilTs: midnightBefore(untilTs, 0) };
}

/** Summarizes a message lookback or timed window, paced by the declared interval. */
export const summarize = defineRuleAction({
  ...AFTER_MESSAGE,
  type: 'summaries.summarize',
  before: 'file',
  label: 'Summarize',
  hint: 'Summarizes the channel over the time before the message; at most once an hour per rule. Uses your AI plan.',
  targets: ['message', 'window'],
  minIntervalMs: MS_PER_HOUR,
  create: (): SummarizeConfig => ({ lookbackMs: MS_PER_HOUR }),
  validate(c: SummarizeConfig) {
    if (!(c.lookbackMs > 0)) throw new Error('Pick how far back the summary reaches.');
    if (c.range !== undefined && !RULE_SUMMARY_RANGES.includes(c.range)) throw new Error('Pick the time frame.');
    const optionsError = summaryRuleOptionsError(c);
    if (optionsError) throw new Error(optionsError);
    for (const kind of SUMMARY_PROMPT_KINDS) {
      const own = c.prompts?.[kind];
      const err = own == null ? null : summaryPromptError(own);
      if (err) throw new Error(`${kind === 'merge' ? 'Merge' : 'Summarize'} prompt: ${err}`);
    }
  },
});
