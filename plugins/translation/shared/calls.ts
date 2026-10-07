import { isObj, normalizeProviderId, snowflakeArg } from '@plugin-sdk/shared';
import type { TranslatePick } from './types';

export function decodeNoArgs(args: readonly unknown[]): [] {
  if (args.length !== 0) throw new Error('Expected no arguments.');
  return [];
}

export function decodeTranslate(args: readonly unknown[]): [string, TranslatePick | null] {
  if (args.length !== 2) throw new Error('Expected a message and model.');
  const messageId = snowflakeArg(args[0], 'message');
  const pick = args[1];
  if (pick === null) return [messageId, null];
  if (!isObj(pick) || Object.keys(pick).some((k) => !['provider', 'model'].includes(k))) throw new Error('Not a translation model.');
  const provider = normalizeProviderId(pick.provider);
  if (!provider || typeof pick.model !== 'string' || !pick.model.trim() || pick.model.includes('\0')) throw new Error('Not a translation provider and model.');
  return [messageId, { provider, model: pick.model }];
}
