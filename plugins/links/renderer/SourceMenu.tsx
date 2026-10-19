// The Links header's source filter: a select-style button naming the sources shown, opening a checklist of them.
import { For, Show, createSignal } from 'solid-js';
import { PLATFORMS, PLATFORM_INFO, type Platform } from '@plugin-sdk/shared';
import { listen, look, onPointerDownOutside } from '@plugin-sdk/renderer/kit';
import { linkPlatforms, setLinkPlatforms } from './state';
import { PLATFORM_ICON_PATHS } from './platformIcons';
import styles from './LinkFilters.module.css';

/** Sources named on the button before it reads "N of M sources". */
const MAX_NAMED_SOURCES = 2;
/** Picked sources' marks on the button; more are in its name. */
const MAX_TRIGGER_MARKS = 3;

type Counts = Partial<Record<Platform, number>>;

/** Every source shows while none is picked; else the picked ones. */
const shown = (p: Platform): boolean => !linkPlatforms().length || linkPlatforms().includes(p);

/** Shows or hides one source; every source shown again is no filter. */
function toggle(p: Platform): void {
  const next = PLATFORMS.filter((x) => (x === p ? !shown(p) : shown(x)));
  setLinkPlatforms(next.length === PLATFORMS.length ? [] : next);
}

const Mark = (props: { platform: Platform; class?: string }) => (
  <svg class={`${props.class ?? ''} ${look.lineIcon}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d={PLATFORM_ICON_PATHS[props.platform]} />
  </svg>
);

/** `counts`: links per source under every other filter; sources with none are left out unless picked. */
export function SourceMenu(props: { counts: Counts; class?: string }) {
  let root!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);
  const listed = () => PLATFORMS.filter((p) => props.counts[p] || linkPlatforms().includes(p));
  const picked = () => listed().filter((p) => linkPlatforms().includes(p));
  const label = (): string => {
    const names = picked().map((p) => PLATFORM_INFO[p].label);
    if (!names.length) return 'All sources';
    return names.length <= MAX_NAMED_SOURCES ? names.join(', ') : `${names.length} of ${listed().length} sources`;
  };
  /** The last source shown can't be hidden: an empty list would show nothing. */
  const lastShown = (p: Platform): boolean => shown(p) && listed().filter(shown).length === 1;

  onPointerDownOutside(() => root, open, () => setOpen(false));
  listen(window, 'keydown', (e) => {
    if (open() && e.key === 'Escape') setOpen(false);
  });

  return (
    <div class={`${styles.sources} ${props.class ?? ''}`} ref={root}>
      <button
        type="button"
        class={`${styles.sourceTrigger} ${look.selectTrigger}`}
        aria-haspopup="true"
        aria-expanded={open()}
        aria-label={`Sources: ${label()}`}
        title="Choose which sources' links to show"
        onClick={() => setOpen(!open())}
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
      <Show when={open()}>
        <div class={`cp-popover ${styles.sourceMenu}`} role="group" aria-label="Sources to show">
          <div class={`${styles.sourceHead} ${look.ruleBelow}`} data-rule="subtle">
            <span class={look.text} data-size="2xs" data-weight="semibold" data-case="upper" data-tracking="label" data-tone="muted">
              Sources
            </span>
            <Show when={linkPlatforms().length}>
              <button type="button" class={`${look.link} ${look.text}`} data-size="xs" onClick={() => setLinkPlatforms([])}>
                Show all
              </button>
            </Show>
          </div>
          <For each={listed()}>
            {(p) => (
              <div class={styles.sourceRow}>
                <label
                  class={`${styles.sourceOption} ${look.identityOption} ${look.text}`}
                  data-size="sm"
                  data-platform={p}
                  title={lastShown(p) ? 'At least one source shows' : undefined}
                >
                  <input type="checkbox" checked={shown(p)} disabled={lastShown(p)} onChange={() => toggle(p)} />
                  <span class={`${styles.sourceTile} ${look.identityTile}`}>
                    <Mark platform={p} class={styles.sourceIcon} />
                  </span>
                  <span class={styles.sourceName}>{PLATFORM_INFO[p].label}</span>
                  <span class={`${styles.sourceCount} ${look.text}`} data-size="xs" data-tone="muted" data-figures="tabular">
                    {props.counts[p] ?? 0}
                  </span>
                </label>
                <button
                  type="button"
                  class={`${styles.only} ${look.pillButton} ${look.text}`}
                  data-size="2xs"
                  aria-label={`Show only ${PLATFORM_INFO[p].label}`}
                  onClick={() => setLinkPlatforms([p])}
                >
                  Only
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
