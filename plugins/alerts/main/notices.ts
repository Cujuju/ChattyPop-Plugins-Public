// Notices: what a notification says, once, for every surface that shows one (Windows toasts, phone pushes).
import { plainDiscordText } from '@plugin-sdk/shared';
import { notificationRequest, type Notice, type NotificationRequest } from '@plugin-sdk/main';
import type { AlertDelivery, AlertItem } from '../shared/types';

/** More new alerts than this in one burst become a single notice. */
const MAX_INDIVIDUAL_ALERTS = 3;

/** Notice text and burst grouping for alerts selected by core. */
export function alertNotices(alerts: AlertItem[]): Notice<'alert'>[] {
  if (alerts.length > MAX_INDIVIDUAL_ALERTS) {
    const a = alerts[0]!;
    const rules = [...new Set(alerts.map((x) => x.sourceName))].join(', ');
    return [{ kind: 'alert', title: `${alerts.length} new alerts`, body: rules, open: { channelId: a.channelId, messageId: a.messageId } }];
  }
  return alerts.map((a) => ({
    kind: 'alert',
    title: `${a.sourceName} · #${a.channelName}`,
    body: `${a.authorName}: ${plainDiscordText(a.snippet, { users: a.mentions })}`,
    open: { channelId: a.channelId, messageId: a.messageId },
  }));
}

/** Requests for the alerts core selected: alerts bound for the same devices share notices, so a burst merges only those. */
export function alertRequests(deliveries: AlertDelivery[]): NotificationRequest<'alert'>[] {
  const byDevices = new Map<string, AlertDelivery[]>();
  for (const d of deliveries) {
    const key = [...d.devices].sort().join(',');
    byDevices.set(key, [...(byDevices.get(key) ?? []), d]);
  }
  return [...byDevices.values()].flatMap((group) => {
    const { devices } = group[0]!;
    return alertNotices(group.map((d) => d.alert)).map((notice) => ({
      ...notificationRequest(notice),
      ...(devices.includes('desktop') ? {} : { desktop: false as const }),
      ...(devices.includes('phone') ? {} : { phone: false as const }),
    }));
  });
}
