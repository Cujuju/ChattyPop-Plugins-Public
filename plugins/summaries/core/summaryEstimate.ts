// A summary run's Jev cost projection: the most questions its Jev steps could ask, before anything is sent.
import { SUMMARY_BULLETS, type SummarySettings } from '../shared/settings';
import type { ProviderId } from '@plugin-sdk/shared';
import type { DecisionProvider } from '@plugin-sdk/core';
import { JEV_FILTER_CHECK_QUESTIONS, type LogLine } from './summaryJev';
import type { PromptOptions } from './summaryPrompt';
import { chunk } from './summaryRows';
import { JEV_STEP_QUESTIONS } from './summaryShape';
import type { PluginProvider } from '@plugin-sdk/core';

/** What a run is decided by before any model is called. */
export interface RunPlan {
  providerId: ProviderId;
  provider: PluginProvider;
  model: string | null;
  effort: string | null;
  untilTs: number;
  channelIds: string[];
  /** The whole log, for refs and citations. */
  lines: LogLine[];
  /** The log after the rule-based filler check, when that is on. */
  afterRules: LogLine[];
  /** Each Jev step's decider, its requests reading the run's channels; null when that step is off. */
  jev: Record<'filter' | 'check' | 'quiet' | 'chunk' | 'theme' | 'route', DecisionProvider | null>;
  opts: PromptOptions;
  cacheKey: string;
}

/**
 * An upper bound: every step is counted as if earlier ones dropped nothing, and the citation check as if the summary
 * used its most bullets.
 */
export function maxJevQuestions(p: RunPlan, prefs: SummarySettings): number {
  const lines = p.afterRules;
  const bullets = SUMMARY_BULLETS[prefs.length];
  const channels = new Set(lines.map((l) => l.citation.channelId)).size;
  const maxBullets = prefs.grouping === 'channel' ? bullets.perChannel[1] * channels : bullets.overall[1];
  const cuts = chunk(lines, p.provider.maxInputChars).length - 1;
  return (
    (p.jev.filter ? JEV_FILTER_CHECK_QUESTIONS.filter(lines) : 0) +
    (p.jev.quiet ? JEV_STEP_QUESTIONS.quiet(lines) : 0) +
    (p.jev.route ? JEV_STEP_QUESTIONS.route : 0) +
    (p.jev.chunk && cuts > 0 ? JEV_STEP_QUESTIONS.chunk(cuts) : 0) +
    (p.jev.check ? JEV_FILTER_CHECK_QUESTIONS.check(maxBullets) : 0) +
    (p.jev.theme ? JEV_STEP_QUESTIONS.themes(lines) : 0)
  );
}
