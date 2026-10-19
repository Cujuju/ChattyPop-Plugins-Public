// The Links header's source filter: a select-style button naming the sources shown, opening the kit's checklist of them.
import { For, Show } from 'solid-js';
import { PLATFORMS, PLATFORM_INFO, type Platform } from '@plugin-sdk/shared';
import { FilterMenu, look } from '@plugin-sdk/renderer/kit';
import { linkPlatforms, setLinkPlatforms } from './state';
import { PLATFORM_ICON_PATHS } from './platformIcons';
import styles from './LinkFilters.module.css';

/** Sources named on the button before it reads "N of M sources". */
const MAX_NAMED_SOURCES = 2;
/** Picked sources' marks on the button; more are in its name. */
const MAX_TRIGGER_MARKS = 3;

type Counts = Partial<Record<Platform, number>>;

const Mark = (props: { platform: Platform; class?: string }) => (
  <svg class={`${props.class ?? ''} ${look.lineIcon}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d={PLATFORM_ICON_PATHS[props.platform]} />
  </svg>
);

/** `counts`: links per source under every other filter; sources with none are left out unless picked. */
export function SourceMenu(props: { counts: Counts; class?: string }) {
  const listed = () => PLATFORMS.filter((p) => props.counts[p] || linkPlatforms().includes(p));
  const picked = () => listed().filter((p) => linkPlatforms().includes(p));
  const label = (): string => {
    const names = picked().map((p) => PLATFORM_INFO[p].label);
    if (!names.length) return 'All sources';
    return names.length <= MAX_NAMED_SOURCES ? names.join(', ') : `${names.length} of ${listed().length} sources`;
  };
  const items = () =>
    listed().map((p) => ({ id: p, label: PLATFORM_INFO[p].label, platform: p, mark: <Mark platform={p} />, aside: String(props.counts[p] ?? 0) }));

  return (
    <FilterMenu
      class={props.class}
      label="Sources to show"
      heading="Sources"
      items={items()}
      all={PLATFORMS}
      picked={linkPlatforms()}
      onPick={setLinkPlatforms}
      trigger={(menu) => (
        <button
          type="button"
          class={`${styles.sourceTrigger} ${look.selectTrigger}`}
          aria-haspopup="true"
          aria-expanded={menu.open}
          aria-label={`Sources: ${label()}`}
          title="Choose which sources' links to show"
          onClick={() => menu.toggle()}
        >
          <Show when={picked().length}>
            <span class={styles.triggerMarks}>
              <For each={picked().slice(0, MAX_TRIGGER_MARKS)}>
                {(p) => (
                  <span class={`${styles.triggerTile} ${look.identityTile}`} data-platform={p}>
                    <Mark platform={p} class={styles.triggerIcon} />
                  </span>
                )}
              </For>
            </span>
          </Show>
          <span class={styles.triggerLabel}>{label()}</span>
          <span class="cp-chevron" aria-hidden="true" />
        </button>
      )}
    />
  );
}
