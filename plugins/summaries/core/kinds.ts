// Summary rule actions, coverage and failure events.
import type { SummaryEvent as AppEvent } from '../shared/types';
import { ruleRangeSpan } from '../shared/rules';
import type { SummaryRuleOptions, SummaryTrigger } from '../shared/settings';
import type { TimedTriggerKind } from '@plugin-sdk/shared';
import { errorMessage } from '@plugin-sdk/shared';
import { EmptyRangeError } from './summarize';
import type { CoreContext, CoverageQuery } from '@plugin-sdk/core';
import type { plugin } from '../shared';
import type { Summary, SummaryRequest } from '../shared/types';
import { actionRange } from '@plugin-sdk/core';
import { namedText } from '../shared/people';

/** Run service shared with the action contract tests. */
export interface SummaryRangeDeps {
  /** `quiet`: stored and listed without a notice. */
  summarize(request: SummaryRequest, own: SummaryRuleOptions, trigger: SummaryTrigger, quiet: boolean): Promise<Summary>;
}

/** The rule action that summarizes, as rules store it. */
export const SUMMARIZE_ACTION = 'summaries.summarize';

/** How each timed trigger labels its summaries; the Summary panel and notifications name them. */
export const SUMMARY_TRIGGER: Record<TimedTriggerKind, SummaryTrigger> = {
  daily: 'digest',
  every: 'rule',
  appStart: 'catch-up',
};

/** Registers summary ranges, covered windows and summary-auto-failed events. */
export function registerSummaryKinds(
  k: CoreContext<typeof plugin>['rules'],
  deps: SummaryRangeDeps,
  emit: (e: AppEvent) => void,
  coveredUntil: (q: CoverageQuery) => number | null,
): void {
  k.windows.coveredUntil(coveredUntil);
  k.action(SUMMARIZE_ACTION, async (c, r) => {
    const trigger = r.event.kind === 'window' ? SUMMARY_TRIGGER[r.event.timing] : 'rule';
    const { lookbackMs: _, range, ...own } = c;
    const covered = actionRange(r, c.lookbackMs);
    // Catching up missed due times, oldest first: only the newest window's summary notifies.
    const quiet = r.event.kind === 'window' && r.event.owedAfter > 0;
    // A failure the schedule will retry is not reported: only the last attempt's.
    const retrying = r.event.kind === 'window' && r.event.retriesLeft > 0;
    // A picked time frame replaces a timed window's span, ending where it ends; its channels stay.
    const { channelIds, ...span } = range && r.event.kind === 'window' ? { ...covered, ...ruleRangeSpan(range, covered.untilTs) } : covered;
    try {
      const summary = await deps.summarize(channelIds ? { ...span, channelIds } : span, own, trigger, quiet);
      return { outcome: 'done', detail: namedText(summary.headline, summary.people) || null };
    } catch (err) {
      if (err instanceof EmptyRangeError) return { outcome: 'skipped', detail: err.message };
      if (r.event.kind === 'window' && !retrying) emit({ type: 'summary-auto-failed', trigger, message: errorMessage(err), ...(channelIds && { channelIds }) });
      return { outcome: 'failed', detail: errorMessage(err) };
    }
  });
}
