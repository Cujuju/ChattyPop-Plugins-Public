import { isObj, normalizeProviderId, snowflakeArg } from '@plugin-sdk/shared';
import type { EnginePick } from './types';

export function decodeNoArgs(args: readonly unknown[]): [] {
  if (args.length !== 0) throw new Error('Expected no arguments.');
  return [];
}

export function decodeRequest(args: readonly unknown[]): [string, EnginePick | null] {
  if (args.length !== 2) throw new Error('Expected a message and engine.');
  const messageId = snowflakeArg(args[0], 'message');
  const pick = args[1];
  if (pick === null) return [messageId, null];
  if (!isObj(pick)) throw new Error('Not an engine image text reads with.');
  if (pick.engine === 'windows' && Object.keys(pick).every((k) => k === 'engine')) return [messageId, { engine: 'windows' }];
  if (pick.engine !== 'vision' || Object.keys(pick).some((k) => !['engine', 'provider', 'model'].includes(k))) throw new Error('Not a vision engine.');
  const provider = normalizeProviderId(pick.provider);
  if (!provider || typeof pick.model !== 'string' || !pick.model.trim() || pick.model.includes('\0')) throw new Error('Not a vision provider and model.');
  return [messageId, { engine: 'vision', provider, model: pick.model }];
}
