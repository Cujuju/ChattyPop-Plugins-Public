// Shared summary preferences. Normalizes stored JSON into complete settings for core and renderer.
import { bool, isObj, normalizeProviderId, oneOf, textOrNull, type ProviderId } from '@plugin-sdk/shared';
import { NO_PROMPT_OVERRIDES, normalizeSummaryPrompts, type SummaryPromptTemplates } from './prompts';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MIN } from '@plugin-sdk/shared';
import { cutText } from '@plugin-sdk/shared';
import { normalizeCompareModels, type CompareModel } from './compare';

/** Ordered ranges with persisted keys. Null ms denotes session end, latest summary end, local today, or previous local day. Renamed keys reset defaultRange. */
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

/** Prompt bullet-count ranges [min,max]. Standard uses 3–8; per-channel counts apply separately to each active channel. */
export const SUMMARY_BULLETS: Record<SummaryLength, { overall: readonly [number, number]; perChannel: readonly [number, number] }> = {
  brief: { overall: [2, 4], perChannel: [1, 2] },
  standard: { overall: [3, 8], perChannel: [1, 4] },
  detailed: { overall: [6, 14], perChannel: [2, 6] },
};

/** Reader-context character limit. */
export const SUMMARY_FOCUS_MAX_CHARS = 500;

export interface SummarySettings {
  /** The AI provider summaries use, with its Settings → AI model and effort; null = none chosen (nothing runs). */
  defaultProvider: ProviderId | null;
  /** Enables rule-based filler filtering for summary input. */
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
  /** Settings → Summaries → Compare models: the models a comparison runs, in column order. */
  compareModels: CompareModel[];
}

export const DEFAULT_SUMMARY_SETTINGS: SummarySettings = {
  defaultProvider: null,
  skipObviousFiller: false,
  jevRouting: {
    cheapModel: null,
    premiumModel: null,
    cheapEffort: null,
    premiumEffort: null,
  },
  // Detailed bullets request self-contained information.
  length: 'detailed',
  grouping: 'overall',
  // Requests reader-specific actions in summary output.
  actionItems: true,
  focus: '',
  defaultRange: 'since',
  notifyAuto: true,
  prompts: NO_PROMPT_OVERRIDES,
  compareModels: [],
};

/** What a summarize rule sets for its own runs; each absent option follows Settings → Summaries. */
export interface SummaryRuleOptions {
  provider?: ProviderId;
  length?: SummaryLength;
  grouping?: SummaryGrouping;
  actionItems?: boolean;
  /** '' = a neutral summary, whatever Settings' focus is. */
  focus?: string;
  skipObviousFiller?: boolean;
  /** Own prompt templates (#88); a null kind follows the owner's. */
  prompts?: SummaryPromptTemplates;
}

/** The settings a rule's run uses: its own options over the owner's. */
export const withRuleOptions = (prefs: SummarySettings, own: SummaryRuleOptions | undefined): SummarySettings =>
  own
    ? {
        ...prefs,
        defaultProvider: own.provider ?? prefs.defaultProvider,
        length: own.length ?? prefs.length,
        grouping: own.grouping ?? prefs.grouping,
        actionItems: own.actionItems ?? prefs.actionItems,
        focus: own.focus ?? prefs.focus,
        skipObviousFiller: own.skipObviousFiller ?? prefs.skipObviousFiller,
        prompts: own.prompts ? { summarize: own.prompts.summarize ?? prefs.prompts.summarize, merge: own.prompts.merge ?? prefs.prompts.merge } : prefs.prompts,
      }
    : prefs;

const isBool = (v: unknown): boolean => v === undefined || typeof v === 'boolean';

/** Why a rule's options can't run, or null; prompts are checked by the action. */
export function summaryRuleOptionsError(o: SummaryRuleOptions): string | null {
  if (o.provider !== undefined && normalizeProviderId(o.provider) === null) return 'Pick a provider.';
  if (o.length !== undefined && !SUMMARY_LENGTHS.includes(o.length)) return 'Pick a length.';
  if (o.grouping !== undefined && !SUMMARY_GROUPINGS.includes(o.grouping)) return 'Pick a layout.';
  if (!isBool(o.actionItems) || !isBool(o.skipObviousFiller)) return 'Pick on or off.';
  if (o.focus !== undefined && (typeof o.focus !== 'string' || o.focus.length > SUMMARY_FOCUS_MAX_CHARS))
    return `Keep what matters to you under ${SUMMARY_FOCUS_MAX_CHARS} characters.`;
  return null;
}

export function normalizeSummarySettings(v: unknown): SummarySettings {
  const src = isObj(v) ? v : {};
  const d = DEFAULT_SUMMARY_SETTINGS;
  const routing = isObj(src['jevRouting']) ? src['jevRouting'] : {};
  return {
    defaultProvider: normalizeProviderId(src['defaultProvider']),
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
    compareModels: normalizeCompareModels(src['compareModels']),
  };
}
