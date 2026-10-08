// Summary style wording shared by Settings → Summaries and a rule's own options.
import type { ChoiceText } from '@plugin-sdk/renderer/kit';
import { SUMMARY_BULLETS, type SummaryGrouping, type SummaryLength } from '../shared/settings';

const span = (b: readonly [number, number]): string => `${b[0]}–${b[1]}`;
export const LENGTH_LABEL: Record<SummaryLength, string> = { brief: 'Brief', standard: 'Standard', detailed: 'Detailed' };
/** Each layout's text in its select and in one-line states, in select order. */
export const GROUPINGS: Record<SummaryGrouping, ChoiceText> = {
  overall: { option: 'One list, in the order it happened', meta: 'one list' },
  channel: { option: 'Grouped by channel', meta: 'grouped by channel' },
};
/** A length's select options: its name and point count. */
export const LENGTH_OPTIONS = (Object.keys(LENGTH_LABEL) as SummaryLength[]).map((l) => ({
  value: l,
  label: `${LENGTH_LABEL[l]}: ${span(SUMMARY_BULLETS[l].overall)} points`,
}));
/** A length's point counts, overall and per channel. */
export const lengthHint = (l: SummaryLength): string => `${span(SUMMARY_BULLETS[l].overall)} points (${span(SUMMARY_BULLETS[l].perChannel)} per channel).`;
export const LAYOUT_HINT = 'Grouped suits many channels you skim one by one; one list suits a few related channels.';
export const ACTION_ITEMS_HINT =
  'Above the points: questions and requests put to you, deadlines and events, and decisions waiting on your input, each linked to its message. Leaves out anything already answered.';
export const FOCUS_HINT = 'Points about these are kept even when minor. Leave empty for a neutral summary.';
export const FOCUS_PLACEHOLDER = 'e.g. release dates, anything about billing, what Sam decides';
export const FILLER_HINT =
  'Leaves out messages that are only emoji or links, and short throwaways like “lol”, unless they are replies or contain a number or question. Rules, not AI: free and instant. Only summaries skip them; the archive, search and alerts see every message.';
