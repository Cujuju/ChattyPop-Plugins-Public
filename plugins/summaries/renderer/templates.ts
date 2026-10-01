// The original digest and catch-up rule templates.
import { newTimedTrigger } from '@plugin-sdk/shared';
import type { RuleTemplate } from '@plugin-sdk/shared';
import { timedSummaryInput } from '../shared/timedRules';

/** Views of the descriptor's rule templates, by local id. */
export const templates = {
  digest: {
    title: 'Daily digest',
    flow: ['A time of day', 'Summarize'],
    hint: 'A summary of the day so far, at a time and on days you pick.',
    make: () => timedSummaryInput('', newTimedTrigger('daily')).spec,
  },
  catchUp: {
    title: 'Catch me up',
    flow: ['Opening after time away', 'Summarize'],
    hint: 'When ChattyPop opens after you were away, a summary of what you missed.',
    make: () => timedSummaryInput('', newTimedTrigger('appStart')).spec,
  },
} satisfies Readonly<Record<string, RuleTemplate>>;
