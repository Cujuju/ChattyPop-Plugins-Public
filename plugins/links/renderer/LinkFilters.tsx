import { For, Show } from 'solid-js';
import { PLATFORMS, PLATFORM_INFO, type Platform } from '@plugin-sdk/shared';
import { Select, archivedChannels, channelLabel, jevSwitch, look } from '@plugin-sdk/renderer/kit';
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
import styles from './LinkFilters.module.css';

export const linkWorth = jevSwitch(plugin, 'linkWorth');
export const linkSafety = jevSwitch(plugin, 'linkSafety');

type Counts = Partial<Record<Platform, number>>;

/** The channel picker's choices: every archived channel, after "All channels". */
export const channelOptions = () => [{ value: '', label: 'All channels' }, ...archivedChannels().map((c) => ({ value: c.id, label: channelLabel(c, c.guildName) }))];

/** Platform chips with counts: each platform with links for the filter, or picked. `class` lays the group out. */
function PlatformChips(props: { counts: Counts; class?: string }) {
  const togglePlatform = (p: Platform): void => {
    setLinkPlatforms(linkPlatforms().includes(p) ? linkPlatforms().filter((x) => x !== p) : [...linkPlatforms(), p]);
  };
  return (
    <div class={props.class} role="group" aria-label="Platforms">
      <For each={PLATFORMS.filter((p) => props.counts[p] || linkPlatforms().includes(p))}>
        {(p) => (
          <button
            type="button"
            class={`${styles.chip} ${look.filterChip} ${look.text}`}
            data-size="xs"
            data-font="sans"
            data-platform={p}
            aria-pressed={linkPlatforms().includes(p)}
            onClick={() => togglePlatform(p)}
          >
            {PLATFORM_INFO[p].label}{' '}
            <span class={look.text} data-size="2xs" data-tone="muted">
              {props.counts[p] ?? 0}
            </span>
          </button>
        )}
      </For>
    </div>
  );
}

/**
 * The Links panel's filter bar: platform chips with counts, channel, date range, order and the flagged toggle; `counts`
 * are the per-platform totals for the filter.
 */
export function LinkFilters(props: { counts: Counts }) {
  return (
    <header class={`${styles.filters} ${look.ruleBelow}`}>
      <PlatformChips counts={props.counts} class={styles.platforms} />
      <Select class={styles.select} label="Channel" value={linkChannelId() ?? ''} options={channelOptions()} onChange={(v) => setLinkChannelId(v || null)} />
      <Select
        class={styles.select}
        label="Date range"
        value={linkRange()}
        options={Object.entries(LINK_RANGES).map(([id, r]) => ({ value: id, label: r.label }))}
        onChange={(v) => setLinkRange(v as LinkRange)}
      />
      <Show when={linkWorth.on()}>
        <Select
          class={styles.select}
          label="Order"
          value={linkSort()}
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'worth', label: 'Most worth reading' },
          ]}
          onChange={(v) => setLinkSort(v as LinkSort)}
        />
      </Show>
      <Show when={linkSafety.on()}>
        <label class={`${styles.toggle} ${look.text}`} data-size="xs" data-tone="secondary">
          <input type="checkbox" checked={linkHideFlagged()} onChange={(e) => setLinkHideFlagged(e.currentTarget.checked)} />
          Hide flagged
        </label>
      </Show>
    </header>
  );
}

/** The phone's filter bar: the platform chips on one row that scrolls sideways. The other filters are in LinkFilterSheet. */
export function PhoneLinkFilters(props: { counts: Counts }) {
  return (
    <header class={look.ruleBelow}>
      <PlatformChips counts={props.counts} class={styles.platformRow} />
    </header>
  );
}
