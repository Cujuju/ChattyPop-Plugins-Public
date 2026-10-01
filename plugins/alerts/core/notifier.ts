// Desktop notifications for new alerts and the debounced alerts-changed event: the one notifier every rule's Alert uses.
import type { ArchivePayloadReader } from '@plugin-sdk/core';
import { isLive, type LiveAt, type PluginDb, type PluginDecider } from '@plugin-sdk/core';
import type { AlertItem } from '../shared/types';
import { isRepeat } from './dedupe';
import { alertItems } from './queries';

/** Coalesces bursts of new alerts into one event. */
export const ALERT_EVENT_DEBOUNCE_MS = 250;

/** An alert an Alert action stored for this check, awaiting the notify decision (Jev's urgency answer may come later). */
export interface Fresh {
  ruleId: number;
  /** The rule's Alert action; its cooldown is kept per action. */
  actionId: string;
  alertId: number;
  liveAt: LiveAt;
  /** null: the action never notifies. */
  cooldownMs: number | null;
}

/** When each rule's Alert action last notified, by `rule:action`: kept for the core process, so off/on keeps cooldowns. */
export type AlertCooldowns = Map<string, number>;

export class AlertNotifier {
  /** Alerts to notify with the next event, by id: each is read again then, so one hidden or read meanwhile drops out. */
  private pendingNotify: number[] = [];
  private disposed = false;
  private pendingEvent: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: PluginDb,
    private readonly payloads: ArchivePayloadReader,
    private readonly emit: (notify: AlertItem[]) => void,
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
    if (urgent !== false) for (const f of fresh) this.notifyIfDue(f);
    this.changed();
  }

  /** Alerts changed: one alerts-changed event per burst, carrying the notifications queued meanwhile. */
  changed(): void {
    if (this.disposed) return;
    this.pendingEvent ??= setTimeout(() => {
      const ids = this.pendingNotify;
      this.pendingNotify = [];
      this.pendingEvent = undefined;
      this.emit(ids.flatMap((id) => this.deliverable(id) ?? []));
    }, ALERT_EVENT_DEBOUNCE_MS);
  }

  /** Alert `id` as it may notify now: visible (privacy mode) and unread; else null. */
  private deliverable(id: number): AlertItem | null {
    const item = alertItems(this.db, this.payloads, { limit: 1 }, id)[0];
    return item && item.readAt === null ? item : null;
  }

  /**
   * Queues a desktop notification when the action notifies, the message is live, the alert unread and visible (privacy
   * mode), the action has cooled down, and (#55) Jev doesn't find it repeats the rule's last alert.
   */
  private notifyIfDue(f: Fresh): void {
    if (f.cooldownMs === null || !isLive(f.liveAt)) return;
    const key = `${f.ruleId}:${f.actionId}`;
    const now = Date.now();
    if (!this.deliverable(f.alertId) || now - (this.lastNotified.get(key) ?? 0) < f.cooldownMs) return;
    this.lastNotified.set(key, now);
    const jev = this.jevFor('dedupeAlerts');
    if (!jev) {
      this.pendingNotify.push(f.alertId);
      return;
    }
    void isRepeat(this.db, jev, f.ruleId, f.alertId, () => !this.disposed).then((repeat) => {
      if (this.disposed) return;
      if (!repeat) this.pendingNotify.push(f.alertId);
      this.changed();
    });
  }
}
