// Summary Jev switches' Settings rows: their original descriptions (their names are the descriptor's).
import { RoutingModels } from './RoutingModels';
import type { JevFeatureView } from '@plugin-sdk/renderer';
import type { SummaryFeature } from '../shared/queries';

/** Wording supplied only while Summaries is active. */
export const SUMMARY_FEATURE_INFO: Readonly<Record<SummaryFeature, JevFeatureView>> = {
  summaryFilter: {
    group: 'Summaries',
    hint: 'Jev reads each message with its neighbours and leaves out only ones it is confident add nothing. Any Jev error keeps everything.',
  },
  citationCheck: {
    group: 'Summaries',
    hint: 'Flags summary points whose cited messages don’t back them up. Nothing is removed.',
  },
  skipQuietStretches: {
    group: 'Summaries',
    hint: 'Stretches Jev finds nothing notable in are left out; if the whole range is quiet, no summary call is made.',
  },
  conversationChunks: {
    group: 'Summaries',
    hint: 'When a range is summarized in parts, Jev picks the cut where a conversation ends instead of cutting mid-thread.',
  },
  keyThemes: {
    group: 'Summaries',
    hint: 'The summary names a few themes; Jev sorts each message under one, so every theme links to its messages.',
  },
  modelRouting: {
    Body: RoutingModels,
    group: 'Summaries',
    hint: 'For OpenRouter summaries, Jev rates how complex the conversation is and picks the cheap or premium model set below.',
  },
};
