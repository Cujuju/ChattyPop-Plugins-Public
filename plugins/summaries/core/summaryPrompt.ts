// Summary prompts, schema and partial-run merging.
import { DEFAULT_SUMMARY_PROMPTS, fillSummaryPrompt, type SummaryPromptKind, type SummaryPromptPlaceholder, type SummaryPromptTemplates } from '../shared/prompts';
import { SUMMARY_BULLETS, type SummaryGrouping, type SummaryLength } from '../shared/settings';
import type { ThemeDraft } from './summaryShape';

/** Bump when prompts or schema change: cached summaries under the old version are not reused. */
export const PROMPT_VERSION = 4;
/** Bump when the theme prompt or schema changes: cached summaries with the old themes are not reused. */
export const THEMES_VERSION = 2;
/** #59: themes the model names; Jev then sorts each message under one. */
const MIN_THEMES = 3;
const MAX_THEMES = 6;

/** Everything that shapes a prompt; each field is part of the summary cache key. */
export interface PromptOptions {
  length: SummaryLength;
  grouping: SummaryGrouping;
  actionItems: boolean;
  focus: string;
  /** The reader's Discord names, so what is asked of them can be recognised; null until the signed-in user is known. */
  reader: string[] | null;
  /** #59 key themes (Jev sorts messages under them afterwards). */
  themes: boolean;
  /** The owner's templates (a rule's own over the global ones); null = default. */
  templates: SummaryPromptTemplates;
}

/** Text with the refs of the messages it covers: a point's part, or an action. */
export interface DraftPart {
  text: string;
  refs: string[];
}

export interface DraftPoint {
  parts: DraftPart[];
}

export interface Draft {
  headline: string;
  items: DraftPoint[];
  /** Present only when action items were asked for. */
  actions?: DraftPart[];
  themes?: ThemeDraft[];
}

const PART = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'refs'],
  properties: { text: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } } },
};
const POINTS = {
  type: 'array',
  items: { type: 'object', additionalProperties: false, required: ['parts'], properties: { parts: { type: 'array', items: PART } } },
};
const ACTIONS = { type: 'array', items: PART };
const THEMES = {
  type: 'array',
  items: { type: 'object', additionalProperties: false, required: ['title', 'description'], properties: { title: { type: 'string' }, description: { type: 'string' } } },
};

/** Strict schemas need every property required, so `actions` and `themes` exist only when asked for. */
export function schemaFor(o: PromptOptions): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'items', ...(o.actionItems ? ['actions'] : []), ...(o.themes ? ['themes'] : [])],
    properties: { headline: { type: 'string' }, items: POINTS, ...(o.actionItems ? { actions: ACTIONS } : {}), ...(o.themes ? { themes: THEMES } : {}) },
  };
}

/** Local "Thu Sep 24 14:03", or "14:03" when every message is on one day. */
export function stamp(ms: number, withDate: boolean): string {
  const d = new Date(ms);
  const time = d.toTimeString().slice(0, 5);
  return withDate ? `${d.toDateString().slice(0, 10)} ${time}` : time;
}

/** How much each point says. Every length reports facts, never just that a topic came up. */
const DEPTH: Record<SummaryLength, string> = {
  brief: 'Each bullet: one concrete sentence with the key fact.',
  standard:
    'Each bullet: two to four sentences covering who, what exactly (names, numbers, dates, versions, prices, links), why, and where it stands now.',
  detailed:
    'Each bullet: a short paragraph (three to six sentences): who said what, the specifics (names, numbers, dates, versions, prices, links), the reasoning and any disagreement, what was decided and what is still open. Quote a short phrase when the exact wording matters.',
};

function bulletRule(o: PromptOptions): string {
  const b = SUMMARY_BULLETS[o.length];
  return o.grouping === 'channel'
    ? `then ${b.perChannel[0]}-${b.perChannel[1]} bullets for each channel with meaningful activity. Each bullet is about one channel and cites only its messages; write a channel's bullets together in the order things happened, channels in the order they became active.`
    : `then ${b.overall[0]}-${b.overall[1]} bullets on the most important conversations, in the order they started.`;
}

function actionRule(o: PromptOptions): string {
  if (!o.actionItems) return '';
  const who = o.reader?.length ? ` The reader appears in the log as ${o.reader.map((n) => `"${n}"`).join(' or ')}.` : '';
  return `Under "actions", list what needs the reader: questions or requests put to them or to everyone, deadlines and events (with their date), and decisions waiting on their input.${who}
One line each, starting with a verb, saying who is asking and by when, citing refs like the bullets. Leave out anything the log shows was already answered or done; leave the list empty when nothing needs them.`;
}

function focusRule(o: PromptOptions): string {
  return o.focus ? `The reader's priorities, in their words: """${o.focus}""". Keep points about these even when minor.` : '';
}

const themesRule = (o: PromptOptions): string =>
  o.themes
    ? `Also name ${MIN_THEMES}-${MAX_THEMES} key themes that together group the conversation: a short title (2-5 words) and one sentence saying which messages belong to it.`
    : '';

const mergeActionRule = (o: PromptOptions): string =>
  o.actionItems ? 'Merge the partial action lists the same way: drop duplicates and anything a later part shows was answered or done.' : '';

const REFS: Record<SummaryPromptKind, string> = {
  summarize:
    'Write each bullet as one or more parts in order. A part is the sentences about one thread (one exchange, or the same people on one sub-topic) with the refs (like "m12") of the messages it covers; start a new part when the bullet moves to another thread. Use only refs that appear in the log.',
  merge:
    'Write each bullet as parts the same way, keeping every ref (like "m12") with the text it supports as you combine parts; never invent refs.',
};

/** The owner's template for `kind` (or the default) with every placeholder filled from the options. */
function fill(kind: SummaryPromptKind, o: PromptOptions, now: number): string {
  const values: Record<SummaryPromptPlaceholder, string> = {
    now: stamp(now, true),
    bullets: bulletRule(o),
    depth: DEPTH[o.length],
    refs: REFS[kind],
    actions: kind === 'summarize' ? actionRule(o) : mergeActionRule(o),
    focus: focusRule(o),
    themes: themesRule(o),
  };
  return fillSummaryPrompt(o.templates[kind] ?? DEFAULT_SUMMARY_PROMPTS[kind], values);
}

/** Instructions for summarizing one part of the log; `now` lets relative dates ("tomorrow") resolve. */
export const systemPrompt = (o: PromptOptions, now: number): string => fill('summarize', o, now);

/** Instructions for merging the partial summaries of a log too long for one call. */
export const mergePrompt = (o: PromptOptions, now: number): string => fill('merge', o, now);

/** A partial summary as the merge call reads it; with channel grouping each bullet names its channel, which refs alone don't show. */
export function partialText(d: Draft, part: number, channelOf: (ref: string) => string | undefined, grouping: SummaryGrouping): string {
  const cited = (p: DraftPart): string => `${p.text} [${p.refs.join(', ')}]`;
  const line = (p: DraftPoint): string => {
    const ch = grouping === 'channel' ? channelOf(p.parts[0]?.refs[0]?.trim() ?? '') : undefined;
    return `- ${ch ? `#${ch}: ` : ''}${p.parts.map(cited).join(' ')}`;
  };
  const actions = d.actions?.length ? `\nActions:\n${d.actions.map((a) => `- ${cited(a)}`).join('\n')}` : '';
  const themes = d.themes?.length ? `\nThemes: ${d.themes.map((t) => `${t.title} (${t.description})`).join('; ')}` : '';
  return `Part ${part}: ${d.headline}\n${d.items.map(line).join('\n')}${actions}${themes}`;
}

/** A point as one claim with all its refs, for the citation check (which judges whole points). */
export const wholePoint = (p: DraftPoint): DraftPart => ({ text: p.parts.map((x) => x.text).join(' '), refs: p.parts.flatMap((x) => x.refs) });
