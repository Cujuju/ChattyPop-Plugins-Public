// The phone's Links filters: a bottom sheet with the platforms, channel, date range, order and flagged filters.
import { For, Show, createEffect, type JSX } from 'solid-js';
import type { Platform } from '@plugin-sdk/shared';
import { SegButton, SegGroup, Select, Switch, look } from '@plugin-sdk/renderer/kit';
import type { LinkSort } from '../shared/types';
import { PlatformChips, channelOptions, linkSafety, linkWorth } from './LinkFilters';
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
const ORDERS: readonly { value: LinkSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'worth', label: 'Worth reading' },
];

/** A filter: its label over its control. */
const Field = (props: { label: string; for?: string; children: JSX.Element }) => (
  <div class={styles.field}>
    <label for={props.for} class={look.text} {...LABEL}>
      {props.label}
    </label>
    {props.children}
  </div>
);

/**
 * The sheet, shown while `open`; a tap outside, Done or Escape closes it (`onClose`). Each change filters the feed behind
 * it at once; Reset, shown while any filter is set, puts them all back. `counts` are the platforms' totals.
 */
export function LinkFilterSheet(props: { open: boolean; counts: Partial<Record<Platform, number>>; onClose: () => void }) {
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
        <header class={styles.sheetHead}>
          <h2 id="links-filters-title" class={`${styles.sheetTitle} ${look.text}`} data-size="xl" data-weight="semibold">
            Filters
          </h2>
          <Show when={linkFilterCount() > 0}>
            <button type="button" class={`${styles.resetLink} ${look.quietLink} ${look.text}`} data-size="md" data-font="sans" onClick={resetLinkFilters}>
              Reset
            </button>
          </Show>
        </header>
        <Field label="Platforms">
          <PlatformChips counts={props.counts} class={styles.sheetChips} chipClass={styles.sheetChip} icons />
        </Field>
        <Field label="Channel" for="links-filter-channel">
          <Select id="links-filter-channel" class={styles.fieldSelect} value={linkChannelId() ?? ''} options={channelOptions()} onChange={(v) => setLinkChannelId(v || null)} />
        </Field>
        <Field label="Shared">
          <SegGroup role="radiogroup" ariaLabel="Date range" class={styles.segments} value={linkRange()} onChange={(v: LinkRange) => setLinkRange(v)}>
            <For each={Object.entries(LINK_RANGES)}>{([id, r]) => <SegButton value={id} label={r.short} size="sm" class={styles.segment} />}</For>
          </SegGroup>
        </Field>
        <Show when={linkWorth.on()}>
          <Field label="Order">
            <SegGroup role="radiogroup" ariaLabel="Order" class={styles.segments} value={linkSort()} onChange={(v: LinkSort) => setLinkSort(v)}>
              <For each={ORDERS}>{(o) => <SegButton value={o.value} label={o.label} size="sm" class={styles.segment} />}</For>
            </SegGroup>
          </Field>
        </Show>
        <Show when={linkSafety.on()}>
          <div class={`${styles.switchRow} ${look.ruleAbove} ${look.text}`} data-rule="subtle" data-size="lg">
            <label for="links-filter-flagged">Hide flagged links</label>
            <Switch id="links-filter-flagged" checked={linkHideFlagged()} onChange={setLinkHideFlagged} />
          </div>
        </Show>
        <button
          type="button"
          class={`${styles.sheetDone} ${look.button} ${look.text}`}
          data-variant="primary"
          data-size="lg"
          data-weight="semibold"
          data-font="sans"
          onClick={() => dialog.close()}
        >
          Done
        </button>
      </div>
    </dialog>
  );
}
