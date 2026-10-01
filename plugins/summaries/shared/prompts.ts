// Editable summary prompt templates (Settings → Summaries → Prompts, and a rule's own prompt).
// Core fills the placeholders from the summary settings; the text around them is the owner's.
import { isObj } from '@plugin-sdk/shared';

export const SUMMARY_PROMPT_KINDS = ['summarize', 'merge'] as const;
export type SummaryPromptKind = (typeof SUMMARY_PROMPT_KINDS)[number];

/** Each kind's template; null = the default (in a rule: the owner's global prompt). */
export type SummaryPromptTemplates = Record<SummaryPromptKind, string | null>;
export const NO_PROMPT_OVERRIDES: SummaryPromptTemplates = { summarize: null, merge: null };

/** What each placeholder becomes, in the order the editor lists them. */
export const SUMMARY_PROMPT_PLACEHOLDERS = {
  now: 'The date and time of the run.',
  bullets: 'How many points and how they are laid out (Length and Layout).',
  depth: 'How much each point says (Length).',
  refs: 'How to cite messages. Required: sources link through it.',
  actions: 'The “For you” list instructions; empty when it is off.',
  focus: 'Your “What matters to you” text; empty when blank.',
  themes: 'Key themes instructions; empty when Jev key themes are off.',
} as const;
export type SummaryPromptPlaceholder = keyof typeof SUMMARY_PROMPT_PLACEHOLDERS;
const REQUIRED: readonly SummaryPromptPlaceholder[] = ['refs'];
const PLACEHOLDER = /\{([a-z]+)\}/g;

/** Room for about four times the default; the prompt goes with every part of every run, so it stays bounded. */
export const SUMMARY_PROMPT_MAX_CHARS = 6000;

export const DEFAULT_SUMMARY_PROMPTS: Record<SummaryPromptKind, string> = {
  summarize: `You summarize Discord conversations for someone catching up after being away. It is now {now}.
Write a headline of one or two sentences with the gist, {bullets}
{depth}
Write so the reader never needs to open the messages: state the actual content, not that it was discussed.
Good: "Sam traced the red build to the SQLite prebuild missing after the bump; pinning the prebuild fixed it, and main has been green since 14:10."
Bad: "Build issues were discussed."
{refs}
Skip greetings, small talk and memes unless they dominate. Messages marked (deleted) were removed by their author.
{actions}
{focus}
{themes}`,
  merge: `You merge partial summaries of consecutive parts of one Discord conversation into one summary. It is now {now}.
Write a headline of one or two sentences, {bullets} Combine overlapping points, keeping every specific (names, numbers, dates, reasons).
{depth}
{refs}
{actions}
{focus}
{themes}`,
};

const isPlaceholder = (name: string): name is SummaryPromptPlaceholder => Object.hasOwn(SUMMARY_PROMPT_PLACEHOLDERS, name);

/** Why a template can't be used, or null when it can. */
export function summaryPromptError(text: string): string | null {
  if (!text.trim()) return 'Write the prompt, or reset it.';
  if (text.length > SUMMARY_PROMPT_MAX_CHARS) return `Keep the prompt under ${SUMMARY_PROMPT_MAX_CHARS} characters.`;
  const unknown = [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!).find((n) => !isPlaceholder(n));
  if (unknown) return `{${unknown}} isn't a placeholder. Use ${Object.keys(SUMMARY_PROMPT_PLACEHOLDERS).map((p) => `{${p}}`).join(', ')}.`;
  const missing = REQUIRED.find((p) => !text.includes(`{${p}}`));
  return missing ? `Keep {${missing}}: ${SUMMARY_PROMPT_PLACEHOLDERS[missing]}` : null;
}

/** Fills each placeholder; a line that held only placeholders which came out empty is dropped. */
export function fillSummaryPrompt(template: string, values: Record<SummaryPromptPlaceholder, string>): string {
  return template
    .split('\n')
    .flatMap((line) => {
      const filled = line.replace(PLACEHOLDER, (raw, name: string) => (isPlaceholder(name) ? values[name] : raw));
      return filled !== line && !filled.trim() ? [] : [filled];
    })
    .join('\n');
}

/** Stored templates; anything unusable falls back to null (the default). */
export function normalizeSummaryPrompts(v: unknown): SummaryPromptTemplates {
  const src = isObj(v) ? v : {};
  const one = (x: unknown): string | null => (typeof x === 'string' && summaryPromptError(x) === null ? x : null);
  return { summarize: one(src['summarize']), merge: one(src['merge']) };
}
