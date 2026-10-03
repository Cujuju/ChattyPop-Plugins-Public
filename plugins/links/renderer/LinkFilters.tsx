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

/** The order's options on the phone's sheet; the desktop header has a switch instead (LinkFilters). */
const ORDERS: readonly { value: LinkSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'worth', label: 'Worth reading' },
];

/**
 * Platform chips: each platform with links for the filter, or picked. `class` lays the group out, `chipClass` each
 * chip, `textSize` the chip's text (`look.text` data-size). Full: icon, name and count. `brief`: the icon alone, name
 * and count in the chip's tooltip and accessible name (the desktop header, where width is short).
 */
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

/** A header switch with its name after it, at the header's control height. */
const ToolSwitch = (props: { checked: boolean; onChange: (on: boolean) => void; label: string }) => (
  <label class={`${styles.tool} ${styles.toggle} ${look.toggleLabel} ${look.text}`} data-size="xs" data-tone="secondary" data-font="sans">
    <Switch checked={props.checked} onChange={props.onChange} />
    {props.label}
  </label>
);

/**
 * The Links panel's filters in its header, all on the title's line: the channel picker, the platform chips (icons
 * alone), the range, and the order and flagged switches; the picker gives way first. `counts` are the per-platform
 * totals for the filter.
 */
export function LinkFilters(props: { counts: Counts }) {
  return (
    <div class={styles.tools}>
      <Select class={styles.select} label="Channel" value={linkChannelId() ?? ''} options={channelOptions()} onChange={(v) => setLinkChannelId(v || null)} />
      <PlatformChips counts={props.counts} class={`${styles.tool} ${styles.platforms}`} textSize="xs" brief />
      <RangeSegments class={styles.tool} brief />
      <Show when={linkWorth.on()}>
        <ToolSwitch checked={linkSort() === 'worth'} onChange={(on) => setLinkSort(on ? 'worth' : 'newest')} label="Worth first" />
      </Show>
      <Show when={linkSafety.on()}>
        <ToolSwitch checked={linkHideFlagged()} onChange={setLinkHideFlagged} label="Hide flagged" />
      </Show>
    </div>
  );
}
