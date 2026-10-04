// Summary notices shared by desktop and phone delivery.
import { notificationRequest, type NotificationRequest } from '@plugin-sdk/main';
import type { SummaryEvent } from '../shared/types';
import type { SummaryTrigger } from '../shared/settings';
import { namedText } from '../shared/people';

const AUTO_RUN_NAME: Record<Exclude<SummaryTrigger, 'manual'>, string> = { 'catch-up': 'Catch-up summary', digest: 'Daily digest', rule: 'Rule summary' };

/** A notice that opens the app as it was, about `channelIds` when known: muting all of them mutes it. */
const notice = (title: string, body: string, channelIds: string[] | undefined): NotificationRequest<'summary'> => ({
  ...notificationRequest({ kind: 'summary', title, body, open: null }),
  ...(channelIds?.length && { aboutChannels: channelIds }),
});

/** Automatic run notices before the plugin's delivery preference. */
export function summaryNotices(e: SummaryEvent): NotificationRequest<'summary'>[] {
  if (e.type === 'summary-added' && e.summary.trigger !== 'manual') {
    const name = AUTO_RUN_NAME[e.summary.trigger];
    const title = e.summary.actions.length ? `${name} · ${e.summary.actions.length} for you` : name;
    return [notice(title, namedText(e.summary.headline, e.summary.people), e.summary.channelIds)];
  }
  if (e.type === 'summary-auto-failed' && e.trigger !== 'manual') {
    return [notice(`${AUTO_RUN_NAME[e.trigger]} failed`, e.message, e.channelIds)];
  }
  return [];
}
