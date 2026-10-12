// Timed summaries that failed and are still owed, as the Summary panel lists them.
import type { CoreContext } from '@plugin-sdk/core';
import type { plugin } from '../shared';
import { ruleRangeSpan, type SummarizeConfig } from '../shared/rules';
import type { SummaryRunFailure } from '../shared/types';
import { SUMMARIZE_ACTION, SUMMARY_TRIGGER } from './kinds';

type Rules = CoreContext<typeof plugin>['rules'];

/** Each failed timed summary with the span it was to read: its rule's picked time frame, else its window. */
export function summaryFailures(rules: Rules): SummaryRunFailure[] {
  const specs = new Map(rules.read().map((r) => [r.id, r.spec]));
  return rules.failedWindows(SUMMARIZE_ACTION).map((w) => {
    const config = specs.get(w.ruleId)?.actions.find((a) => a.id === w.actionId)?.config as SummarizeConfig | undefined;
    const span = config?.range ? ruleRangeSpan(config.range, w.untilTs) : { sinceTs: w.sinceTs, untilTs: w.untilTs };
    return {
      runId: w.runId,
      actionId: w.actionId,
      ruleName: w.ruleName,
      ...span,
      trigger: SUMMARY_TRIGGER[w.timing],
      claimedAt: w.claimedAt,
      message: w.detail ?? '',
      retryAt: w.retryAt,
    };
  });
}
