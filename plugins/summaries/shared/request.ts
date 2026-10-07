// A summary request as a caller sent it (the phone makes the call), checked before a run starts.
import { isObj, normalizeProviderId, snowflakeArg } from '@plugin-sdk/shared';
import type { SummaryRequest, SummaryScope } from './types';

/** A time in ms, or it throws. */
function time(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Not a ${what} time.`);
  return v;
}

/** A list of ids, or it throws naming what they should be. */
function ids(v: unknown, what: 'channel' | 'server'): string[] {
  if (!Array.isArray(v)) throw new Error(`Not a list of ${what}s.`);
  return v.map((id) => snowflakeArg(id, what));
}

/** A scope's servers and channels, or it throws. */
export function decodeScope(v: unknown): SummaryScope {
  if (!isObj(v)) throw new Error('Not a summary scope.');
  return { guildIds: ids(v['guildIds'], 'server'), channelIds: ids(v['channelIds'], 'channel') };
}

/** summarize's arguments checked: a range, and optionally its channels or scope and provider; throws the reason it isn't one. */
export function decodeSummaryRequest([request]: readonly unknown[]): [SummaryRequest] {
  if (!isObj(request)) throw new Error('Not a summary request.');
  const { sinceTs, untilTs, channelIds, provider } = request;
  const providerId = provider === undefined ? undefined : normalizeProviderId(provider);
  if (providerId === null) throw new Error('Not a provider id.');
  return [{
    sinceTs: time(sinceTs, 'start'),
    ...(untilTs === undefined ? {} : { untilTs: time(untilTs, 'end') }),
    ...(channelIds === undefined ? {} : { channelIds: ids(channelIds, 'channel') }),
    ...(request['scope'] === undefined ? {} : { scope: decodeScope(request['scope']) }),
    ...(providerId === undefined ? {} : { provider: providerId }),
  }];
}
