// The Alerts inbox and message rows.
import { For, Show, createMemo } from 'solid-js';
import { avatarUrl } from '@plugin-sdk/shared';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MIN } from '@plugin-sdk/shared';
import { NOTIFY_DEVICES, type AlertItem, type HeldReason, type NotifyDevice } from '../shared/types';
import {
  alertSort,
  alerts,
  alertsUnreadOnly,
  markAllAlertsRead,
  openAlert,
  setAlertSort,
  setAlertsUnreadOnly,
  shownUnreadAlertCount,
} from './state';
import type { MessageMenuScope } from '@plugin-sdk/renderer';
import {
  rules,
  now,
  isPanelCollapsed,
  openMessageMenuById,
  createFollowBottom,
  percentText,
  shortDate,
  InlineMarkdown,
  PanelHeader,
  HeaderActions,
  HeaderBadge,
  HeaderButton,
  look,
} from '@plugin-sdk/renderer/kit';
import { RuleFilter } from './RuleFilter';
import styles from './Alerts.module.css';

/** F2 age: "12m", "2h", then a short date; follows the clock, so it stays current. */
function age(ts: number): string {
  const ms = now() - ts;
  if (ms < MS_PER_MIN) return 'now';
  if (ms < MS_PER_HOUR) return `${Math.floor(ms / MS_PER_MIN)}m`;
  if (ms < MS_PER_DAY) return `${Math.floor(ms / MS_PER_HOUR)}h`;
  return shortDate(ts);
}

const HELD_LABEL: Record<HeldReason, string> = { cooldown: 'cooldown', notUrgent: 'not urgent', muted: 'muted' };
const HELD_WHY: Record<HeldReason, string> = {
  cooldown: "within the rule's notification cooldown",
  notUrgent: 'Jev judged it not urgent',
  muted: 'its server or channel is muted',
};
const DEVICE_NAME: Record<NotifyDevice, string> = { desktop: 'Windows', phone: 'phone' };

/** #233: why devices the rule notifies were not notified of `a`; null when none was held back. */
function heldNote(a: AlertItem): { label: string; title: string } | null {
  const held = NOTIFY_DEVICES.flatMap((d) => (a.held[d] ? [{ d, reason: a.held[d] }] : []));
  if (!held.length) return null;
  return {
    label: `not sent: ${[...new Set(held.map((h) => HELD_LABEL[h.reason]))].join(', ')}`,
    title: `Not notified: ${held.map((h) => `${DEVICE_NAME[h.d]}, ${HELD_WHY[h.reason]}`).join('; ')}`,
  };
}

/** A rule's heading when alerts are grouped by rule. */
interface RuleHeading {
  heading: string;
  count: number;
}

/** Alerts grouped by rule name, each group oldest first. A heading is reused while its count holds, so its row stays put. */
function byRule(oldestFirst: AlertItem[], headings: Map<string, RuleHeading>): (AlertItem | RuleHeading)[] {
  const groups = new Map<string, AlertItem[]>();
  for (const a of oldestFirst) groups.set(a.sourceName, [...(groups.get(a.sourceName) ?? []), a]);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([name, items]) => {
      const prev = headings.get(name);
      const heading = prev?.count === items.length ? prev : { heading: name, count: items.length };
      headings.set(name, heading);
      return [heading, ...items];
    });
}

/** F2 Alerts: rules' matches, newest at the bottom or grouped by rule; unread ones marked; a row opens its message in the Archive. */
export function AlertsPanel() {
  // Grouped by rule, the newest alert isn't at the bottom: nothing to follow.
  const log = createFollowBottom(() => alertSort() === 'rule');
  /** Core pages newest first. */
  const oldestFirst = () => [...(alerts() ?? [])].reverse();
  const headings = new Map<string, RuleHeading>();
  const entries = createMemo(() => (alertSort() === 'rule' ? byRule(oldestFirst(), headings) : oldestFirst()));
  return (
    <section class="cp-panel" aria-label="Alerts">
      <PanelHeader section="alerts" collapsible title="Alerts">
        <Show when={shownUnreadAlertCount() > 0}>
          <HeaderBadge title="Mark these alerts read" onClick={() => void markAllAlertsRead()}>
            {shownUnreadAlertCount()} new
          </HeaderBadge>
        </Show>
        <HeaderActions>
          <RuleFilter />
          <HeaderButton title="Order alerts by time, or group them by rule" onClick={() => setAlertSort(alertSort() === 'rule' ? 'time' : 'rule')}>
            {alertSort() === 'rule' ? 'By rule' : 'By time'}
          </HeaderButton>
          <HeaderButton
            title={alertsUnreadOnly() ? 'Showing new alerts only' : 'Showing all alerts'}
            onClick={() => setAlertsUnreadOnly(!alertsUnreadOnly())}
          >
            {alertsUnreadOnly() ? 'New only' : 'All'}
          </HeaderButton>
        </HeaderActions>
      </PanelHeader>
      <Show when={!isPanelCollapsed('alerts')}>
        <Show
          when={alerts().length > 0}
          fallback={
            <p class="cp-panel-empty">
              {rules().some((r) => r.spec.actions.some((a) => a.type === 'alerts.notify'))
                ? 'No matches yet.'
                : 'Add a rule with an Alert to hear when something comes up.'}
            </p>
          }
        >
          <ol class={styles.list} ref={log.ref}>
            <For each={entries()}>
              {(entry) => (
                <Show
                  when={'id' in entry && entry}
                  fallback={
                    <li class={`${styles.groupHeading} ${look.band} ${look.text}`} data-size="xs" data-weight="semibold" data-tone="section">
                      {(entry as RuleHeading).heading} · {(entry as RuleHeading).count}
                    </li>
                  }
                >
                  {(alert) => <AlertRow a={alert()} />}
                </Show>
              )}
            </For>
          </ol>
        </Show>
      </Show>
    </section>
  );
}

/** An alert row draws a snippet of its message, none of its attachments. */
const SNIPPET_ROW: MessageMenuScope = { drawsAttachments: false };

/** One alert: dot | avatar | rule chip, #channel, author … Jev and repeat tags, age / snippet. Right-click: the message menu. */
function AlertRow(props: { a: AlertItem }) {
  const a = props.a;
  /** Unread rows read in full text colour, their marks in the section colour; read ones recede. */
  const unread = (): boolean => a.readAt === null;
  return (
    <li>
      <button
        type="button"
        class={`${styles.row} ${look.row} ${look.insetFocus} ${look.ruleBelow} ${look.text}`}
        data-press
        data-rule="subtle"
        data-tone={unread() ? 'primary' : 'secondary'}
        data-unread={a.readAt === null}
        onClick={() => void openAlert(a)}
        onContextMenu={(e) => void openMessageMenuById(e, a.messageId, SNIPPET_ROW)}
      >
        <span class={`${styles.dot} ${look.dot}`} data-fill={unread() ? 'section' : 'ring'} aria-hidden="true" />
        <img data-avatar class={`${styles.avatar} ${look.avatar}`} src={avatarUrl(a.authorId, a.authorAvatar)} alt="" loading="lazy" />
        <span class={styles.main}>
          <span class={`${styles.meta} ${look.text}`} data-size="xs" data-line="meta">
            <span class={`${styles.rule} ${look.tag} ${look.text}`} data-tint={unread() ? 'section' : undefined} data-weight="semibold" title={a.sourceName}>
              {a.sourceName}
            </span>
            <span class={styles.where}>
              <span class={`${styles.channel} ${look.text}`} data-tone={unread() ? 'secondary' : 'muted'}>
                <span class={look.text} data-tone="muted">#</span>
                {a.channelName}
              </span>
              <span class={`${styles.author} ${look.text}`} data-weight="semibold" data-tone={unread() ? 'primary' : 'secondary'}>
                {a.authorName}
              </span>
            </span>
            <span class={styles.tail}>
              <Show when={a.matchKind === 'meaning'}>
                <span
                  class={`cp-micro-tag ${styles.tag} ${look.tag}`}
                  data-tint="ai"
                  data-tag="jev"
                  title="Jev matched this by meaning, with this confidence"
                >
                  Jev {percentText(a.probability ?? 0)}
                </span>
              </Show>
              <Show when={a.duplicateOf !== null}>
                <span class={`cp-micro-tag ${styles.tag} ${look.tag}`} title="A repeat of an earlier alert: not notified">
                  repeat
                </span>
              </Show>
              <Show when={heldNote(a)}>
                {(held) => (
                  <span class={`cp-micro-tag ${styles.tag} ${look.tag}`} title={held().title}>
                    {held().label}
                  </span>
                )}
              </Show>
              <time class={`${styles.age} ${look.text}`} data-tone="muted" dateTime={new Date(a.ts).toISOString()}>
                {age(a.ts)}
              </time>
            </span>
          </span>
          <span class={`${styles.snippet} ${look.text}`} data-size="md" data-line="normal">
            <InlineMarkdown text={a.snippet} mentions={a.mentions} inert />
          </span>
        </span>
        <Show when={a.readAt === null}>
          <span class="cp-visually-hidden">(unread)</span>
        </Show>
      </button>
    </li>
  );
}
