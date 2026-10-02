// Summary preferences shared by core (runs, schedule) and renderer (panel, Settings → Summaries).
// Stored JSON is normalized on read, so a missing or older value always yields a complete, valid object.
import { bool, isObj, oneOf, textOrNull } from '@plugin-sdk/shared';
import { NO_PROMPT_OVERRIDES, normalizeSummaryPrompts, type SummaryPromptTemplates } from './prompts';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MIN } from '@plugin-sdk/shared';
import { cutText } from '@plugin-sdk/shared';

/**
 * Ranges offered in the panel, shortest first. ms null: `since` = end of the previous app session, `last` = end of the
 * newest summary, `today` = local midnight on, `yesterday` = the whole previous local day. Keys are stored (defaultRange):
 * renaming one resets that setting to the default.
 */
export const SUMMARY_RANGES = {
  since: { label: 'Last visit', ms: null },
  last: { label: 'Last run', ms: null },
  today: { label: 'Today', ms: null },
  yesterday: { label: 'Yesterday', ms: null },
  '30m': { label: '30 min', ms: 30 * MS_PER_MIN },
  '1h': { label: '1 hour', ms: MS_PER_HOUR },
  '3h': { label: '3 hours', ms: 3 * MS_PER_HOUR },
  '6h': { label: '6 hours', ms: 6 * MS_PER_HOUR },
  '12h': { label: '12 hours', ms: 12 * MS_PER_HOUR },
  '24h': { label: '24 hours', ms: 24 * MS_PER_HOUR },
  '3d': { label: '3 days', ms: 3 * MS_PER_DAY },
  '7d': { label: '7 days', ms: 7 * MS_PER_DAY },
  '30d': { label: '30 days', ms: 30 * MS_PER_DAY },
} as const;
export type SummaryRange = keyof typeof SUMMARY_RANGES;

export const SUMMARY_LENGTHS = ['brief', 'standard', 'detailed'] as const;
export type SummaryLength = (typeof SUMMARY_LENGTHS)[number];

/** overall: one list in the order things happened. channel: points grouped under the channel they are about. */
export const SUMMARY_GROUPINGS = ['overall', 'channel'] as const;
export type SummaryGrouping = (typeof SUMMARY_GROUPINGS)[number];

/** What started a run: the Summarize button, a timed rule's catch-up (on app start) or digest (daily), or another rule (#88, #96). */
export type SummaryTrigger = 'manual' | 'catch-up' | 'digest' | 'rule';

/**
 * Bullet counts the prompt asks for, [min, max]. Standard keeps the original 3–8.
 * Per channel is per channel with meaningful activity, so the total grows with how many channels were busy.
 */
export const SUMMARY_BULLETS: Record<SummaryLength, { overall: readonly [number, number]; perChannel: readonly [number, number] }> = {
  brief: { overall: [2, 4], perChannel: [1, 2] },
  standard: { overall: [3, 8], perChannel: [1, 4] },
  detailed: { overall: [6, 14], perChannel: [2, 6] },
};

/** About a paragraph: enough to state priorities, small enough not to crowd the prompt. */
export const SUMMARY_FOCUS_MAX_CHARS = 500;

export interface SummarySettings {
  /** Leave out obvious filler without AI; the archive is unaffected. */
  skipObviousFiller: boolean;
  /** OpenRouter models and efforts chosen by conversation complexity. */
  jevRouting: {
    cheapModel: string | null;
    premiumModel: string | null;
    cheapEffort: string | null;
    premiumEffort: string | null;
  };
  length: SummaryLength;
  grouping: SummaryGrouping;
  /** A "For you" list: questions and requests aimed at the reader, deadlines, decisions waiting on input. */
  actionItems: boolean;
  /** The reader's priorities in their own words; matching points are kept even when minor. '' = none. */
  focus: string;
  /** Range the panel starts on. */
  defaultRange: SummaryRange;
  /** Windows notification when an automatic summary (a rule's) is ready or fails. */
  notifyAuto: boolean;
  /** The owner's prompt templates; null = the built-in default. */
  prompts: SummaryPromptTemplates;
}

export const DEFAULT_SUMMARY_SETTINGS: SummarySettings = {
  skipObviousFiller: false,
  jevRouting: {
    cheapModel: null,
    premiumModel: null,
    cheapEffort: null,
    premiumEffort: null,
  },
  // Detailed: each point should carry the information, so the reader rarely has to open the messages.
  length: 'detailed',
  grouping: 'overall',
  // On: it costs a few output tokens and is the part that turns a recap into a to-do list.
  actionItems: true,
  focus: '',
  defaultRange: 'since',
  notifyAuto: true,
  prompts: NO_PROMPT_OVERRIDES,
};

/** The settings a run uses with a rule's own prompts (#88) over the owner's; a null kind keeps the owner's. */
export const withOwnPrompts = (prefs: SummarySettings, own: SummaryPromptTemplates | undefined): SummarySettings =>
  own ? { ...prefs, prompts: { summarize: own.summarize ?? prefs.prompts.summarize, merge: own.merge ?? prefs.prompts.merge } } : prefs;

export function normalizeSummarySettings(v: unknown): SummarySettings {
  const src = isObj(v) ? v : {};
  const d = DEFAULT_SUMMARY_SETTINGS;
  const routing = isObj(src['jevRouting']) ? src['jevRouting'] : {};
  return {
    skipObviousFiller: bool(src['skipObviousFiller'], d.skipObviousFiller),
    jevRouting: {
      cheapModel: textOrNull(routing['cheapModel']),
      premiumModel: textOrNull(routing['premiumModel']),
      cheapEffort: textOrNull(routing['cheapEffort']),
      premiumEffort: textOrNull(routing['premiumEffort']),
    },
    length: oneOf(SUMMARY_LENGTHS, src['length'], d.length),
    grouping: oneOf(SUMMARY_GROUPINGS, src['grouping'], d.grouping),
    actionItems: bool(src['actionItems'], d.actionItems),
    focus: typeof src['focus'] === 'string' ? cutText(src['focus'].trim(), SUMMARY_FOCUS_MAX_CHARS) : d.focus,
    defaultRange: oneOf(Object.keys(SUMMARY_RANGES) as SummaryRange[], src['defaultRange'], d.defaultRange),
    notifyAuto: bool(src['notifyAuto'], d.notifyAuto),
    prompts: normalizeSummaryPrompts(src['prompts']),
  };
}
