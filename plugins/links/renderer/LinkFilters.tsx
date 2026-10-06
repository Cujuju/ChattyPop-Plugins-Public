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

/** `label`: on the phone's sheet; `brief`: on the desktop header's one button, where width is short. */
const ORDERS: readonly { value: LinkSort; label: string; brief: string }[] = [
  { value: 'newest', label: 'Newest', brief: 'Newest' },
  { value: 'worth', label: 'Worth reading', brief: 'Worth' },
];
const orderOf = (value: LinkSort) => ORDERS.find((o) => o.value === value) ?? ORDERS[0]!;
const otherOrder = (value: LinkSort) => ORDERS.find((o) => o.value !== value) ?? ORDERS[0]!;

/** Shows platforms with links or selected filters. Full chips show icon, name, count; brief chips move names/counts to tooltips and accessible labels. */
export function PlatformChips(props: { counts: Counts; class?: string; chipClass?: string; textSize: 'xs' | 'md'; brief?: boolean }) {
  const togglePlatform = (p: Platform): void => {
    setLinkPlatforms(linkPlatforms().includes(p) ? linkPlatforms().filter((x) => x !== p) : [...linkPlatforms(), p]);
  };
  const described = (p: Platform) => `${PLATFORM_INFO[p].label}, ${props.counts[p] ?? 0}`;
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
            aria-label={props.brief ? described(p) : undefined}
            title={props.brief ? described(p) : undefined}
            onClick={() => togglePlatform(p)}
          >
            <svg class={`${styles.chipIcon} ${look.lineIcon}`} viewBox="0 0 24 24" aria-hidden="true">
              <path d={PLATFORM_ICON_PATHS[p]} />
            </svg>
            <Show when={!props.brief}>
              <span class={styles.chipLabel}>{PLATFORM_INFO[p].label}</span>
              <span class={look.text} data-size="2xs" data-tone="muted" data-figures="tabular">
                {props.counts[p] ?? 0}
              </span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}

type SegmentProps = { class?: string; segmentClass?: string; brief?: boolean };

/** The date range as a segmented control; `class` lays the track out, `segmentClass` each option; `brief` shortens the labels. */
export const RangeSegments = (props: SegmentProps) => (
  <SegGroup role="radiogroup" ariaLabel="Date range" class={props.class} value={linkRange()} onChange={(v: LinkRange) => setLinkRange(v)}>
    <For each={Object.entries(LINK_RANGES)}>{([id, r]) => <SegButton value={id} label={props.brief ? r.brief : r.label} size="sm" class={props.segmentClass} />}</For>
  </SegGroup>
);

/** The order as a segmented control (shown while Jev rates links); props as RangeSegments, less `brief`. */
export const OrderSegments = (props: Omit<SegmentProps, 'brief'>) => (
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

/** Header filters: channel, platform icons, range, order, flagged. The channel picker shrinks first; counts contains filtered platform totals. */
export function LinkFilters(props: { counts: Counts }) {
  return (
    <div class={styles.tools}>
      <Select class={styles.select} label="Channel" value={linkChannelId() ?? ''} options={channelOptions()} onChange={(v) => setLinkChannelId(v || null)} />
      <PlatformChips counts={props.counts} class={`${styles.tool} ${styles.platforms}`} textSize="xs" brief />
      <RangeSegments class={styles.tool} brief />
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
