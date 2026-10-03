import { For, Show } from 'solid-js';
import { PLATFORMS, PLATFORM_INFO, type Platform } from '@plugin-sdk/shared';
import { SegButton, SegGroup, Select, Switch, archivedChannels, channelLabel, jevSwitch, look } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import type { LinkSort } from '../shared/types';
import {
  LINK_RANGES,
  linkChannelId,
  linkHideFlagged,
  linkPlatforms,
  linkRange,
  linkSort,
  setLinkChannelId,
  setLinkHideFlagged,
  setLinkPlatforms,
  setLinkRange,
  setLinkSort,
  type LinkRange,
} from './state';
import { PLATFORM_ICON_PATHS } from './platformIcons';
import styles from './LinkFilters.module.css';

export const linkWorth = jevSwitch(plugin, 'linkWorth');
export const linkSafety = jevSwitch(plugin, 'linkSafety');

type Counts = Partial<Record<Platform, number>>;

/** The channel picker's choices: every archived channel, after "All channels". */
export const channelOptions = () => [{ value: '', label: 'All channels' }, ...archivedChannels().map((c) => ({ value: c.id, label: channelLabel(c, c.guildName) }))];

const ORDERS: readonly { value: LinkSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'worth', label: 'Worth reading' },
];

/**
 * Platform chips: each platform with links for the filter, or picked; its icon, name and count. `class` lays the group
 * out, `chipClass` each chip, `textSize` the chip's text (`look.text` data-size).
 */
export function PlatformChips(props: { counts: Counts; class?: string; chipClass?: string; textSize: 'xs' | 'md' }) {
  const togglePlatform = (p: Platform): void => {
    setLinkPlatforms(linkPlatforms().includes(p) ? linkPlatforms().filter((x) => x !== p) : [...linkPlatforms(), p]);
  };
  return (
    <div class={props.class} role="group" aria-label="Platforms">
      <For each={PLATFORMS.filter((p) => props.counts[p] || linkPlatforms().includes(p))}>
        {(p) => (
          <button
            type="button"
            class={`${props.chipClass ?? styles.chip} ${look.filterChip} ${look.text}`}
            data-size={props.textSize}
            data-font="sans"
            data-platform={p}
            aria-pressed={linkPlatforms().includes(p)}
            onClick={() => togglePlatform(p)}
          >
            <Show when={PLATFORM_ICON_PATHS[p]}>
              {(path) => (
                <svg class={`${styles.chipIcon} ${look.lineIcon}`} viewBox="0 0 24 24" aria-hidden="true">
                  <path d={path()} />
                </svg>
              )}
            </Show>
            <span class={styles.chipLabel}>{PLATFORM_INFO[p].label}</span>
            <span class={look.text} data-size="2xs" data-tone="muted" data-figures="tabular">
              {props.counts[p] ?? 0}
            </span>
          </button>
        )}
      </For>
    </div>
  );
}

/** The date range as a segmented control; `class` lays the track out. */
export const RangeSegments = (props: { class?: string }) => (
  <SegGroup role="radiogroup" ariaLabel="Date range" class={props.class} value={linkRange()} onChange={(v: LinkRange) => setLinkRange(v)}>
    <For each={Object.entries(LINK_RANGES)}>{([id, r]) => <SegButton value={id} label={r.short} size="sm" class={styles.segment} />}</For>
  </SegGroup>
);

/** The order as a segmented control (shown while Jev rates links); `class` lays the track out. */
export const OrderSegments = (props: { class?: string }) => (
  <SegGroup role="radiogroup" ariaLabel="Order" class={props.class} value={linkSort()} onChange={(v: LinkSort) => setLinkSort(v)}>
    <For each={ORDERS}>{(o) => <SegButton value={o.value} label={o.label} size="sm" class={styles.segment} />}</For>
  </SegGroup>
);

/**
 * The Links panel's filters, in its header after the title: the platform chips, then the channel picker, date range,
 * order and the flagged switch; each group wraps to its own header line when the header is too narrow for all of them.
 * `counts` are the per-platform totals for the filter.
 */
export function LinkFilters(props: { counts: Counts }) {
  return (
    <div class={styles.filters}>
      <PlatformChips counts={props.counts} class={styles.platforms} textSize="xs" />
      <div class={styles.controls}>
        <Select class={styles.select} label="Channel" value={linkChannelId() ?? ''} options={channelOptions()} onChange={(v) => setLinkChannelId(v || null)} />
        <RangeSegments />
        <Show when={linkWorth.on()}>
          <OrderSegments />
        </Show>
        <Show when={linkSafety.on()}>
          <label class={`${styles.toggle} ${look.toggleLabel} ${look.text}`} data-size="xs" data-tone="secondary" data-font="sans">
            <Switch checked={linkHideFlagged()} onChange={setLinkHideFlagged} />
            Hide flagged
          </label>
        </Show>
      </div>
    </div>
  );
}
