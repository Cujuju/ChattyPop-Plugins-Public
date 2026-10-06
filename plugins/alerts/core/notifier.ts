// Notifications for new alerts, per device, and the debounced alerts-changed event: the one notifier every rule's Alert uses.
import type { ArchivePayloadReader } from '@plugin-sdk/core';
import { isLive, notificationMuted, type LiveAt, type PluginDb, type PluginDecider } from '@plugin-sdk/core';
import { NOTIFY_DEVICES, type AlertDelivery, type AlertItem, type HeldReason, type NotifyDevice } from '../shared/types';
import { isRepeat } from './dedupe';
import { alertItems } from './queries';
import { HELD_COLUMN } from './schema';
import { ALERTS } from './tables';

/** Coalesces bursts of new alerts into one event. */
export const ALERT_EVENT_DEBOUNCE_MS = 250;

/** An alert an Alert action stored for this check, awaiting the notify decision (Jev's urgency answer may come later). */
export interface Fresh {
  ruleId: number;
  /** The rule's Alert action; its cooldowns are kept per action and device. */
  actionId: string;
  alertId: number;
  liveAt: LiveAt;
  /** Each device's cooldown; null: the action never notifies it. */
  cooldowns: Record<NotifyDevice, number | null>;
}

/** When each rule's Alert action last notified each device, by `rule:action:device`: kept for the core process, so off/on keeps cooldowns. */
export type AlertCooldowns = Map<string, number>;

const cooldownKey = (f: Fresh, device: NotifyDevice): string => `${f.ruleId}:${f.actionId}:${device}`;

export class AlertNotifier {
  /** Alerts to notify with the next event and their devices: each is read again then, so one hidden or read meanwhile drops out. */
  private pendingNotify: { id: number; devices: NotifyDevice[] }[] = [];
  private disposed = false;
  private pendingEvent: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: PluginDb,
    private readonly payloads: ArchivePayloadReader,
    private readonly emit: (notify: AlertDelivery[]) => void,
    private readonly jevFor: (feature: 'dedupeAlerts') => PluginDecider | null,
    private readonly lastNotified: AlertCooldowns = new Map(),
  ) {}

  /** Cancels queued delivery when the plugin is turned off. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.pendingEvent);
    this.pendingNotify = [];
  }

  /** `urgent` null = not asked or no answer: every due alert notifies, as without Jev. */
  notifyAll(fresh: Fresh[], urgent: boolean | null): void {
    if (this.disposed) return;
    for (const f of fresh) this.notifyIfDue(f, urgent);
    this.changed();
  }

  /** Alerts changed: one alerts-changed event per burst, carrying the notifications queued meanwhile. */
  changed(): void {
    if (this.disposed) return;
    this.pendingEvent ??= setTimeout(() => {
      const queued = this.pendingNotify;
      this.pendingNotify = [];
      this.pendingEvent = undefined;
      this.emit(queued.flatMap(({ id, devices }) => {
        const alert = this.deliverable(id);
        return alert ? [{ alert, devices }] : [];
      }));
    }, ALERT_EVENT_DEBOUNCE_MS);
  }

  /** Alert `id` as it may notify now: visible (privacy mode) and unread; else null. */
  private deliverable(id: number): AlertItem | null {
    const item = alertItems(this.db, this.payloads, { limit: 1 }, id)[0];
    return item && item.readAt === null ? item : null;
  }

  /** Records why `devices` were not notified of alert `id`, for the inbox to show (#233). */
  private hold(id: number, devices: NotifyDevice[], reason: HeldReason): void {
    for (const d of devices) this.db.prepare(`UPDATE ${ALERTS} SET ${HELD_COLUMN[d]} = ? WHERE id = ?`).run(reason, id);
  }

  /** Notifies configured devices for live, unread, visible alerts after mute, urgency, cooldown, and repeat checks. Records mute, urgency, and cooldown outcomes. */
  private notifyIfDue(f: Fresh, urgent: boolean | null): void {
    const devices = NOTIFY_DEVICES.filter((d) => f.cooldowns[d] !== null);
    if (!devices.length || !isLive(f.liveAt)) return;
    const alert = this.deliverable(f.alertId);
    if (!alert) return;
    // Checked here, not only by the host: a burst merges alerts into one notice, which names one place.
    if (notificationMuted(this.db, alert.channelId)) return this.hold(f.alertId, devices, 'muted');
    if (urgent === false) return this.hold(f.alertId, devices, 'notUrgent');
    const now = Date.now();
    const due = devices.filter((d) => now - (this.lastNotified.get(cooldownKey(f, d)) ?? 0) >= f.cooldowns[d]!);
    this.hold(f.alertId, devices.filter((d) => !due.includes(d)), 'cooldown');
    if (!due.length) return;
    for (const d of due) this.lastNotified.set(cooldownKey(f, d), now);
    const jev = this.jevFor('dedupeAlerts');
    if (!jev) {
      this.pendingNotify.push({ id: f.alertId, devices: due });
      return;
    }
    void isRepeat(this.db, jev, f.ruleId, f.alertId, () => !this.disposed).then((repeat) => {
      if (this.disposed) return;
      if (!repeat) this.pendingNotify.push({ id: f.alertId, devices: due });
      this.changed();
    });
  }
}
