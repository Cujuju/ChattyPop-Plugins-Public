import { For, Show } from 'solid-js';
import { PLATFORMS, PLATFORM_INFO, type Platform } from '@plugin-sdk/shared';
import { SegButton, SegGroup, Switch, TimeWindowSelect, jevSwitch, look } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import type { LinkSort } from '../shared/types';
import {
  linkHideFlagged,
  linkPlatforms,
  linkSort,
  linkWindow,
  setLinkHideFlagged,
  setLinkPlatforms,
  setLinkSort,
  setLinkWindow,
} from './state';
import { PLATFORM_ICON_PATHS } from './platformIcons';
import { SourceMenu } from './SourceMenu';
import styles from './LinkFilters.module.css';

export const linkWorth = jevSwitch(plugin, 'linkWorth');
export const linkSafety = jevSwitch(plugin, 'linkSafety');

type Counts = Partial<Record<Platform, number>>;


/** `label`: on the phone's sheet; `brief`: on the desktop header's one button, where width is short. */
const ORDERS: readonly { value: LinkSort; label: string; brief: string }[] = [
  { value: 'newest', label: 'Newest', brief: 'Newest' },
  { value: 'worth', label: 'Worth reading', brief: 'Worth' },
];
const orderOf = (value: LinkSort) => ORDERS.find((o) => o.value === value) ?? ORDERS[0]!;
const otherOrder = (value: LinkSort) => ORDERS.find((o) => o.value !== value) ?? ORDERS[0]!;

/** The phone sheet's platform toggles: each platform with links, or picked, as a chip with its icon, name and count. */
export function PlatformChips(props: { counts: Counts; class?: string; chipClass?: string }) {
  const togglePlatform = (p: Platform): void => {
    setLinkPlatforms(linkPlatforms().includes(p) ? linkPlatforms().filter((x) => x !== p) : [...linkPlatforms(), p]);
  };
  return (
    <div class={props.class} role="group" aria-label="Platforms">
      <For each={PLATFORMS.filter((p) => props.counts[p] || linkPlatforms().includes(p))}>
        {(p) => (
          <button
            type="button"
            class={`${props.chipClass ?? ''} ${look.filterChip} ${look.text}`}
            data-size="md"
            data-font="sans"
            data-platform={p}
            aria-pressed={linkPlatforms().includes(p)}
            onClick={() => togglePlatform(p)}
          >
            <svg class={`${styles.chipIcon} ${look.lineIcon}`} viewBox="0 0 24 24" aria-hidden="true">
              <path d={PLATFORM_ICON_PATHS[p]} />
            </svg>
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

/** When links were shared, as AI chat's time window picks it; `id` for a label's `for`, `class` sizes it. */
export const WindowSelect = (props: { id?: string; class?: string }) => (
  <TimeWindowSelect id={props.id} label="Shared" class={props.class} window={linkWindow()} onChange={setLinkWindow} />
);

/** The order as a segmented control (shown while Jev rates links); `class` lays the track out, `segmentClass` each option. */
export const OrderSegments = (props: { class?: string; segmentClass?: string }) => (
  <SegGroup role="radiogroup" ariaLabel="Order" class={props.class} value={linkSort()} onChange={(v: LinkSort) => setLinkSort(v)}>
    <For each={ORDERS}>{(o) => <SegButton value={o.value} label={o.label} size="sm" class={props.segmentClass} />}</For>
  </SegGroup>
);

/** The order as one button (shown while Jev rates links): it names the current order, and a click switches to the other. */
const OrderButton = () => (
  <button
    type="button"
    class={`${styles.tool} ${styles.orderButton} ${look.filterChip} ${look.text}`}
    data-size="xs"
    data-font="sans"
    title={`Order: ${orderOf(linkSort()).label}. Click for ${otherOrder(linkSort()).label.toLowerCase()}.`}
    onClick={() => setLinkSort(otherOrder(linkSort()).value)}
  >
    {orderOf(linkSort()).brief}
  </button>
);

/** Header filters: sources, time window, order, flagged (the place is the rail's); counts holds links per source. */
export function LinkFilters(props: { counts: Counts }) {
  return (
    <div class={styles.tools}>
      <SourceMenu counts={props.counts} class={styles.tool} />
      <WindowSelect class={`${styles.tool} ${styles.windowSelect}`} />
      <Show when={linkWorth.on()}>
        <OrderButton />
      </Show>
      <Show when={linkSafety.on()}>
        <label class={`${styles.tool} ${styles.toggle} ${look.toggleLabel} ${look.text}`} data-size="xs" data-tone="secondary" data-font="sans">
          <Switch checked={linkHideFlagged()} onChange={setLinkHideFlagged} />
          Hide flagged
        </label>
      </Show>
    </div>
  );
}
