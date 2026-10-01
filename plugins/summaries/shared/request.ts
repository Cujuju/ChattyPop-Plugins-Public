// A summary request as a caller sent it (the phone makes the call), checked before a run starts.
import { isObj, normalizeProviderId, snowflakeArg } from '@plugin-sdk/shared';
import type { SummaryRequest } from './types';

/** A time in ms, or it throws. */
function time(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Not a ${what} time.`);
  return v;
}

/** summarize's arguments checked: a range, and optionally its channels and provider; throws the reason it isn't one. */
export function decodeSummaryRequest([request]: readonly unknown[]): [SummaryRequest] {
  if (!isObj(request)) throw new Error('Not a summary request.');
  const { sinceTs, untilTs, channelIds, provider } = request;
  if (channelIds !== undefined && !Array.isArray(channelIds)) throw new Error('Not a list of channels.');
  const providerId = provider === undefined ? undefined : normalizeProviderId(provider);
  if (providerId === null) throw new Error('Not a provider id.');
  return [{
    sinceTs: time(sinceTs, 'start'),
    ...(untilTs === undefined ? {} : { untilTs: time(untilTs, 'end') }),
    ...(channelIds === undefined ? {} : { channelIds: channelIds.map((id) => snowflakeArg(id, 'channel')) }),
    ...(providerId === undefined ? {} : { provider: providerId }),
  }];
}
