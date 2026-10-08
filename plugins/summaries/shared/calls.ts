import { isObj } from '@plugin-sdk/shared';
import type { SummaryPromptTemplates } from './prompts';
import { summaryRuleOptionsError, type SummaryRuleOptions } from './settings';

const RULE_OPTION_KEYS: readonly (keyof SummaryRuleOptions)[] = ['provider', 'length', 'grouping', 'actionItems', 'focus', 'skipObviousFiller', 'prompts'];

function decodeTemplates(own: unknown): SummaryPromptTemplates {
  if (!isObj(own) || Object.keys(own).some((k) => !['summarize', 'merge'].includes(k))) throw new Error('Not prompt templates.');
  const { summarize, merge } = own;
  if ((summarize !== null && typeof summarize !== 'string') || (merge !== null && typeof merge !== 'string')) throw new Error('Not prompt templates.');
  return { summarize, merge };
}

/** prompts' optional rule options (a rule editor's preview), checked. */
export function decodePrompts(args: readonly unknown[]): [SummaryRuleOptions?] {
  if (args.length > 1) throw new Error('Expected optional rule options.');
  const own = args[0];
  if (own === undefined) return [];
  if (!isObj(own) || Object.keys(own).some((k) => !(RULE_OPTION_KEYS as string[]).includes(k))) throw new Error('Not rule options.');
  const options = { ...own, ...(own['prompts'] === undefined ? {} : { prompts: decodeTemplates(own['prompts']) }) } as SummaryRuleOptions;
  const err = summaryRuleOptionsError(options);
  if (err) throw new Error(err);
  return [options];
}

export function decodeSpending(args: readonly unknown[]): [number[]] {
  if (args.length !== 1 || !Array.isArray(args[0])) throw new Error('Expected spending start times.');
  return [Array.from(args[0], (v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Not a spending start time.');
    return v;
  })];
}
