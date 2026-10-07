import { isObj } from '@plugin-sdk/shared';
import type { SummaryPromptTemplates } from './prompts';

export function decodePrompts(args: readonly unknown[]): [SummaryPromptTemplates?] {
  if (args.length > 1) throw new Error('Expected optional prompt templates.');
  const own = args[0];
  if (own === undefined) return [];
  if (!isObj(own) || Object.keys(own).some((k) => !['summarize', 'merge'].includes(k))) throw new Error('Not prompt templates.');
  const { summarize, merge } = own;
  if ((summarize !== null && typeof summarize !== 'string') || (merge !== null && typeof merge !== 'string')) throw new Error('Not prompt templates.');
  return [{ summarize, merge }];
}

export function decodeSpending(args: readonly unknown[]): [number[]] {
  if (args.length !== 1 || !Array.isArray(args[0])) throw new Error('Expected spending start times.');
  return [Array.from(args[0], (v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Not a spending start time.');
    return v;
  })];
}
