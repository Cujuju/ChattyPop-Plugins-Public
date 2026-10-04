// Summary rule actions, coverage and failure events.
import type { SummaryEvent as AppEvent } from '../shared/types';
import type { SummarizeConfig } from '../shared/rules';
import type { SummaryTrigger } from '../shared/settings';
import type { TimedTriggerKind } from '@plugin-sdk/shared';
import { errorMessage } from '@plugin-sdk/shared';
import { EmptyRangeError } from './summarize';
import type { CoreContext, CoverageQuery } from '@plugin-sdk/core';
import type { plugin } from '../shared';
import type { Summary, SummaryRequest } from '../shared/types';
import type { SummaryPromptTemplates } from '../shared/prompts';
import { actionRange } from '@plugin-sdk/core';
import { namedText } from '../shared/people';

/** Run service shared with the action contract tests. */
export interface SummaryRangeDeps {
  summarize(request: SummaryRequest, prompts: SummaryPromptTemplates | undefined, trigger: SummaryTrigger): Promise<Summary>;
}

/** How each timed trigger labels its summaries; the Summary panel and notifications name them. */
const SUMMARY_TRIGGER: Record<TimedTriggerKind, SummaryTrigger> = {
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
  k.action('summaries.summarize', async (c, r) => {
    const trigger = r.event.kind === 'window' ? SUMMARY_TRIGGER[r.event.timing] : 'rule';
    const { channelIds, ...span } = actionRange(r, c.lookbackMs);
    try {
      const summary = await deps.summarize(channelIds ? { ...span, channelIds } : span, c.prompts, trigger);
      return { outcome: 'done', detail: namedText(summary.headline, summary.people) || null };
    } catch (err) {
      if (err instanceof EmptyRangeError) return { outcome: 'skipped', detail: err.message };
      if (r.event.kind === 'window') emit({ type: 'summary-auto-failed', trigger, message: errorMessage(err), ...(channelIds && { channelIds }) });
      return { outcome: 'failed', detail: errorMessage(err) };
    }
  });
}
