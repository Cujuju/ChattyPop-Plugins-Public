// Built-in Jev queries that shape summaries (#50, #51, #56, #58, #59, #60). Defaults are the tuned originals.
import type { JevFeatureDecl, JevQueryDef } from '@plugin-sdk/shared';

/** Drops messages or stretches only below 20% relevance probability to favor retaining summary input. */
const KEEP_AT = 0.2;
const CONVERSATION_SEES = '`conversation`: a run of chat lines (author: text) from one channel, in order.';

/** Summaries' Settings → Jev switches, keyed as they were before Summaries was a plugin (adopted as summaries.<key>). */
export const SUMMARY_FEATURES = [
  { key: 'summaryFilter', label: 'Skip filler in summaries', default: false },
  { key: 'citationCheck', label: 'Check summary citations', default: false },
  { key: 'skipQuietStretches', label: 'Skip quiet stretches', default: false },
  { key: 'conversationChunks', label: 'Split long summaries by conversation', default: false },
  { key: 'keyThemes', label: 'Key themes with sources', default: false },
  { key: 'modelRouting', label: 'Cheap or premium model by complexity', default: false },
] as const satisfies readonly JevFeatureDecl[];
export type SummaryFeature = (typeof SUMMARY_FEATURES)[number]['key'];

export const SUMMARY_QUERIES: readonly JevQueryDef<SummaryFeature>[] = [
  {
    id: 'summaries.filler',
    group: 'Summaries',
    label: 'Skip filler',
    features: ['summaryFilter'],
    sees: `${CONVERSATION_SEES} Asked about each line; a failed answer keeps the line.`,
    placeholders: ['{k}'],
    use: 'decision',
    condition: 'Keep the message',
    defaults: {
      type: 'noul',
      question: 'Does `conversation[{k}]` carry information someone catching up on this chat would need?',
      yes: 'It states a fact, decision, plan, question, answer, request, opinion or link that matters, or it is needed to understand another message.',
      no: 'It adds nothing needed: a greeting, reaction, emoji, laugh or acknowledgement whose meaning is already clear without it.',
      minProbability: KEEP_AT,
    },
  },
  {
    id: 'summaries.citation',
    group: 'Summaries',
    label: 'Citation check',
    features: ['citationCheck'],
    sees: '`claim` (a summary point), `cited_messages` (the messages it cites) and `context` (the message before each).',
    use: 'fixed-options',
    condition: null,
    defaults: {
      type: 'choice',
      question: 'How do `cited_messages` relate to `claim`? `context` holds the messages just before them, only to help read them.',
      options: [
        { name: 'supports', description: '`cited_messages` state the claim or directly imply that it is true.' },
        { name: 'contradicts', description: '`cited_messages` state the opposite of the claim or imply that it is false.' },
        { name: 'says_nothing', description: '`cited_messages` do not address what the claim asserts, either way.' },
      ],
      alertOn: ['supports'],
      minProbability: 0.5,
    },
  },
  {
    id: 'summaries.quiet',
    group: 'Summaries',
    label: 'Skip quiet stretches',
    features: ['skipQuietStretches'],
    sees: `${CONVERSATION_SEES} Asked per stretch of 30 lines.`,
    use: 'decision',
    condition: 'Keep the stretch',
    defaults: {
      type: 'noul',
      question: 'Does `conversation` contain anything someone catching up on this chat would need to know?',
      yes: 'At least one message states a fact, decision, plan, question, answer, request or link that matters.',
      no: 'It is only greetings, jokes, reactions and small talk.',
      minProbability: KEEP_AT,
    },
  },
  {
    id: 'summaries.boundary',
    group: 'Summaries',
    label: 'Where a conversation ends',
    features: ['conversationChunks'],
    sees: 'Two neighbouring chat lines near a long summary’s size limit; the cut goes where they continue least.',
    vars: ['`previous`: the earlier line', '`next`: the line after it'],
    use: 'rank',
    condition: null,
    defaults: {
      type: 'noul',
      question: 'Does `next` continue the same conversation as `previous`?',
      yes: '`next` replies to, follows up on or stays on the subject of `previous`.',
      no: '`next` starts something new or belongs to another conversation.',
      minProbability: 0.5,
    },
  },
  {
    id: 'summaries.themes',
    group: 'Summaries',
    label: 'Sort messages into key themes',
    features: ['keyThemes'],
    sees: `${CONVERSATION_SEES} The options are the themes your AI provider named for this summary, plus "none".`,
    placeholders: ['{k}'],
    use: 'dynamic-options',
    optionsNote: 'The options are the themes named for each summary, so only the question and threshold can change.',
    condition: 'Put the message in the theme',
    defaults: {
      type: 'choice',
      question: 'Which theme is `conversation[{k}]` part of?',
      options: [],
      alertOn: [],
      // At least even odds.
      minProbability: 0.5,
    },
  },
  {
    id: 'summaries.complexity',
    group: 'Summaries',
    label: 'Complex enough for the premium model',
    features: ['modelRouting'],
    sees: `${CONVERSATION_SEES} A sample of 40 lines from each end of the run.`,
    use: 'decision',
    condition: 'Use the premium model',
    defaults: {
      type: 'score',
      question: 'How hard is `conversation` to summarize well?',
      levels: ['Simple: small talk or one clear thread.', 'Moderate: a few threads or some detail.', 'Complex: many threads, technical detail, disagreements or decisions to track.'],
      // Between the top two levels: closer to "complex" than "moderate".
      minScore: 1.5,
    },
  },
];
