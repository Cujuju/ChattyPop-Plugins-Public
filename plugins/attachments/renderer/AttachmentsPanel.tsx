import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js';
import { DayDivider, HeaderActions, HeaderButton, HeaderMeta, Icon, JumpToNewest, PanelHeader, VirtualRows, createFollowBottom, createVirtualLog, dayLabel, formatBytes, isPanelCollapsed } from '@plugin-sdk/renderer/kit';
import { ATTACHMENTS_PANEL } from '../shared';
import type { AttachmentItem } from '../shared/types';
import { attachments, breakdownShown, filterCount, loadOlderAttachments, loads, reloadAttachments, resetFilters, setBreakdownShown, setView, sort, totals, view } from './state';
import { compressionJob, selectedIds, selection } from './selection';
import { AttachmentFilters } from './AttachmentFilters';
import { AttachmentGrid } from './AttachmentGrid';
import { AttachmentList } from './AttachmentList';
import { Breakdown } from './Breakdown';
import { PlaceRail } from './PlaceRail';
import { SelectionBar } from './SelectionBar';
import styles from './Attachments.module.css';

const LOAD_OLDER_THRESHOLD_ROWS = 10;
const INITIAL_TRACK_COUNT = 1;
const INITIAL_ESTIMATE_PX = 1;
type Row = { kind: 'day'; key: string; label: string } | { kind: 'items'; key: string; items: AttachmentItem[] };

export function AttachmentsPanel() {
  const [cols, setCols] = createSignal(INITIAL_TRACK_COUNT);
  const [trackWidth, setTrackWidth] = createSignal(INITIAL_ESTIMATE_PX);
  let measure!: HTMLDivElement;
  const rows = createMemo<Row[]>(() => {
    const out: Row[] = [];
    const count = view() === 'grid' ? cols() : 1;
    let day = '';
    let chunk: AttachmentItem[] = [];
    const flush = (): void => { if (chunk.length) out.push({ kind: 'items', key: chunk[0]!.id, items: chunk }); chunk = []; };
    for (const item of attachments.items) {
      const nextDay = dayLabel(item.ts);
      if (sort() === 'newest' && nextDay !== day) { flush(); out.push({ kind: 'day', key: `day-${item.id}`, label: nextDay }); }
      day = nextDay;
      chunk.push(item);
      if (chunk.length === count) flush();
    }
    flush();
    return out;
  });
  const vlog = createVirtualLog({ rows, estimatePx: () => trackWidth(), olderThresholdRows: LOAD_OLDER_THRESHOLD_ROWS,
    loadOlder: loadOlderAttachments, following: () => log.following(), hasOlder: () => !attachments.reachedStart,
    layoutKey: () => `${view()}:${cols()}:${trackWidth()}`,
  });
  const log = createFollowBottom(() => vlog.holding());
  onMount(() => {
    const readTracks = (): void => {
      const tracks = getComputedStyle(measure).gridTemplateColumns.trim();
      if (!tracks || tracks === 'none') return;
      const widths = tracks.split(' ');
      setCols(Math.max(INITIAL_TRACK_COUNT, widths.length));
      const width = parseFloat(widths[0]!);
      if (width > 0) setTrackWidth(width);
    };
    readTracks();
    const observer = new ResizeObserver(readTracks);
    observer.observe(measure);
    onCleanup(() => observer.disconnect());
    void reloadAttachments();
  });
  createEffect(on(loads, () => queueMicrotask(() => log.scrollToNewest())));
  return (
    <section class="cp-panel" aria-label="Attachments" on:keydown={(e) => { if (e.key === 'Escape') selection.clear(); }}>
      <PanelHeader section={ATTACHMENTS_PANEL} collapsible title="Attachments">
        <HeaderMeta>{totals().count} files · {formatBytes(totals().bytes)}</HeaderMeta>
        <HeaderActions>
          <HeaderButton variant="icon" aria-label="Grid view" aria-pressed={view() === 'grid'} onClick={() => setView('grid')}><Icon name="apps" /></HeaderButton>
          <HeaderButton variant="icon" aria-label="List view" aria-pressed={view() === 'list'} onClick={() => setView('list')}><Icon name="text" /></HeaderButton>
          <HeaderButton aria-pressed={breakdownShown()} title="What takes the space, by server, channel or person" onClick={() => setBreakdownShown(!breakdownShown())}>Disk use</HeaderButton>
          <Show when={filterCount() > 0}><HeaderButton onClick={resetFilters}>Reset</HeaderButton></Show>
        </HeaderActions>
      </PanelHeader>
      <div class={styles.body} hidden={isPanelCollapsed(ATTACHMENTS_PANEL)} style={{ display: isPanelCollapsed(ATTACHMENTS_PANEL) ? 'none' : undefined }} data-selecting={selectedIds().size > 0}>
        <PlaceRail />
        <div class={styles.main}>
          <AttachmentFilters />
          <Show when={breakdownShown()}><Breakdown /></Show>
          <Show when={selectedIds().size > 0 || compressionJob()}><SelectionBar /></Show>
          <Show when={attachments.items.length === 0 && !attachments.loading}><p class={`cp-panel-empty ${styles.empty}`}>No attachments match these filters.</p></Show>
          <div class={styles.scroller} ref={(el) => { vlog.ref(el); log.ref(el); }} onScroll={() => void vlog.onScroll()}>
            <div class={styles.measure} ref={measure} aria-hidden="true" />
            <VirtualRows log={vlog}>{(row) => (
              <Switch>
                <Match when={row().kind === 'day' && row() as Extract<Row, { kind: 'day' }>}>
                  {(day) => <DayDivider label={day().label} />}
                </Match>
                <Match when={row().kind === 'items' && row() as Extract<Row, { kind: 'items' }>}>
                  {(group) => <Show when={view() === 'grid'} fallback={<AttachmentList item={group().items[0]!} loaded={attachments.items} />}>
                    <div class={styles.gridRow} style={{ '--cols': cols() }}><For each={group().items}>{(item) => <AttachmentGrid item={item} loaded={attachments.items} />}</For></div>
                  </Show>}
                </Match>
              </Switch>
            )}</VirtualRows>
          </div>
          <Show when={!log.following()}><JumpToNewest label="Jump to newest attachment" onClick={() => { vlog.holdRow(null); log.scrollToNewest(); }} /></Show>
        </div>
      </div>
    </section>
  );
}
