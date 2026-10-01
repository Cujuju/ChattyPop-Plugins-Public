// Summary action declaration with stable stored identity.
import { MS_PER_HOUR } from '@plugin-sdk/shared';
import { SUMMARY_PROMPT_KINDS, summaryPromptError, type SummaryPromptTemplates } from './prompts';
import { AFTER_MESSAGE, defineRuleAction } from '@plugin-sdk/shared';

/** The message lookback and optional rule prompts; absent prompts use the owner’s settings. */
export interface SummarizeConfig {
  lookbackMs: number;
  prompts?: SummaryPromptTemplates;
}

/** Summarizes a message lookback or timed window, paced by the declared interval. */
export const summarize = defineRuleAction({
  ...AFTER_MESSAGE,
  type: 'summaries.summarize',
  verb: 'summarize',
  before: 'file',
  label: 'Summarize',
  hint: 'Summarizes the channel over the time before the message; at most once an hour per rule. Uses your AI plan.',
  targets: ['message', 'window'],
  minIntervalMs: MS_PER_HOUR,
  create: (): SummarizeConfig => ({ lookbackMs: MS_PER_HOUR }),
  validate(c: SummarizeConfig) {
    if (!(c.lookbackMs > 0)) throw new Error('Pick how far back the summary reaches.');
    for (const kind of SUMMARY_PROMPT_KINDS) {
      const own = c.prompts?.[kind];
      const err = own == null ? null : summaryPromptError(own);
      if (err) throw new Error(`${kind === 'merge' ? 'Merge' : 'Summarize'} prompt: ${err}`);
    }
  },
});
