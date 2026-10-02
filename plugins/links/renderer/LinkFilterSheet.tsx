// The phone's Links filters: a bottom sheet with the channel, date range, order and flagged filters, one per row.
import { For, Show, createEffect } from 'solid-js';
import { SegButton, SegGroup, Select, Switch, look } from '@plugin-sdk/renderer/kit';
import type { LinkSort } from '../shared/types';
import { channelOptions, linkSafety, linkWorth } from './LinkFilters';
import {
  LINK_RANGES,
  linkChannelId,
  linkFilterCount,
  linkHideFlagged,
  linkRange,
  linkSort,
  resetLinkFilters,
  setLinkChannelId,
  setLinkHideFlagged,
  setLinkRange,
  setLinkSort,
  type LinkRange,
} from './state';
import styles from './LinkFilters.module.css';

const LABEL = { 'data-size': 'xs', 'data-weight': 'semibold', 'data-case': 'upper', 'data-tracking': 'label', 'data-tone': 'muted' } as const;
const BUTTON = { 'data-size': 'lg', 'data-weight': 'semibold', 'data-font': 'sans' } as const;
const ORDERS: readonly { value: LinkSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'worth', label: 'Worth reading' },
];

/** The sheet, shown while `open`; a tap outside, Done or Escape closes it (`onClose`). Each change filters the feed behind it at once. */
export function LinkFilterSheet(props: { open: boolean; onClose: () => void }) {
  let dialog!: HTMLDialogElement;
  createEffect(() => {
    if (props.open && !dialog.open) dialog.showModal();
  });
  return (
    // A tap on the backdrop (the dialog itself, outside its content) closes it.
    <dialog
      ref={dialog}
      class={`${styles.sheet} ${look.sheet}`}
      aria-labelledby="links-filters-title"
      onClick={(e) => e.target === dialog && dialog.close()}
      onClose={() => props.onClose()}
    >
      {/* autofocus: opening focuses the sheet's body, not its first control. */}
      <div class={`${styles.sheetBody} ${look.silentFocus} ${look.text}`} data-font="sans" tabIndex={-1} autofocus>
        <h2 id="links-filters-title" class={`${styles.sheetTitle} ${look.text}`} data-size="xl" data-weight="semibold">
          Filters
        </h2>
        <div class={styles.field}>
          <label for="links-filter-channel" class={look.text} {...LABEL}>
            Channel
          </label>
          <Select id="links-filter-channel" class={styles.fieldSelect} value={linkChannelId() ?? ''} options={channelOptions()} onChange={(v) => setLinkChannelId(v || null)} />
        </div>
        <div class={styles.field}>
          <span class={look.text} {...LABEL}>
            Shared
          </span>
          <SegGroup role="radiogroup" ariaLabel="Date range" class={styles.segments} value={linkRange()} onChange={(v: LinkRange) => setLinkRange(v)}>
            <For each={Object.entries(LINK_RANGES)}>{([id, r]) => <SegButton value={id} label={r.short} size="sm" class={styles.segment} />}</For>
          </SegGroup>
        </div>
        <Show when={linkWorth.on()}>
          <div class={styles.field}>
            <span class={look.text} {...LABEL}>
              Order
            </span>
            <SegGroup role="radiogroup" ariaLabel="Order" class={styles.segments} value={linkSort()} onChange={(v: LinkSort) => setLinkSort(v)}>
              <For each={ORDERS}>{(o) => <SegButton value={o.value} label={o.label} size="sm" class={styles.segment} />}</For>
            </SegGroup>
          </div>
        </Show>
        <Show when={linkSafety.on()}>
          <div class={`${styles.switchRow} ${look.text}`} data-size="lg">
            <label for="links-filter-flagged">Hide flagged links</label>
            <Switch id="links-filter-flagged" checked={linkHideFlagged()} onChange={setLinkHideFlagged} />
          </div>
        </Show>
        <div class={styles.sheetActions}>
          <button type="button" class={`${styles.sheetAction} ${look.button} ${look.text}`} {...BUTTON} disabled={linkFilterCount() === 0} onClick={resetLinkFilters}>
            Reset
          </button>
          <button type="button" class={`${styles.sheetAction} ${look.button} ${look.text}`} data-variant="raised" {...BUTTON} onClick={() => dialog.close()}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
