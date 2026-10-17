import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js';
import { DayDivider, HeaderActions, HeaderButton, HeaderMeta, Icon, JumpToNewest, PanelHeader, VirtualRows, createFollowBottom, createVirtualLog, dayLabel, formatBytes, isPanelCollapsed } from '@plugin-sdk/renderer/kit';
import { ATTACHMENTS_PANEL } from '../shared';
import type { AttachmentItem } from '../shared/types';
import {
  attachments, failure, filterCount, hasMoreBelow, loadMoreBelow, loadOlderAttachments, loads, reloadAttachments, resetFilters, setView, sort, topDown,
  totals, view,
  spaceView, setSpaceView,
} from './state';
import { compressionJob, selection } from './selection';
import { filesCount } from './actions';
import { FilterBar, HeaderTools } from './AttachmentFilters';
import { AttachmentGrid } from './AttachmentGrid';
import { AttachmentList, AttachmentListHeader } from './AttachmentList';
import { PlaceRail } from './PlaceRail';
import { SelectionBar } from './SelectionBar';
import { SpaceView } from './SpaceView';
import { folderSaveJob } from './folderSave';
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
      if (sort().key === 'date' && nextDay !== day) { flush(); out.push({ kind: 'day', key: `day-${item.id}`, label: nextDay }); }
      day = nextDay;
      chunk.push(item);
      if (chunk.length === count) flush();
    }
    flush();
    return out;
  });
  const vlog = createVirtualLog({ rows, estimatePx: () => trackWidth(), olderThresholdRows: LOAD_OLDER_THRESHOLD_ROWS,
    loadOlder: loadOlderAttachments, hasOlder: () => !attachments.reachedStart, hasNewer: hasMoreBelow, loadNewer: loadMoreBelow,
    // Top-down, the view stays where the reader put it as more loads below.
    following: () => !topDown() && log.following(),
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
  /** Where the order starts: its first row, at the top or the bottom. */
  const toStart = (): void => {
    const first = rows()[0];
    if (!topDown()) log.scrollToNewest();
    // A row above the view comes in at its top edge.
    else if (first) vlog.scrollToKey(first.key);
  };
  createEffect(on(loads, () => queueMicrotask(toStart)));
  return (
    <section class="cp-panel" aria-label="Attachments" on:keydown={(e) => { if (e.key === 'Escape') selection.done(); }}>
      <PanelHeader section={ATTACHMENTS_PANEL} collapsible title="Attachments">
        <HeaderMeta>{filesCount(totals().count)} · {formatBytes(totals().bytes)}</HeaderMeta>
        <HeaderTools />
        <HeaderActions>
          <HeaderButton aria-pressed={selection.selecting()} title="Pick files to save, compress or delete" onClick={() => selection.selecting() ? selection.done() : selection.start()}>Select</HeaderButton>
          <HeaderButton variant="icon" aria-label="Grid view" aria-pressed={!spaceView() && view() === 'grid'} onClick={() => { setSpaceView(false); void setView('grid'); }}><Icon name="apps" /></HeaderButton>
          <HeaderButton variant="icon" aria-label="List view" aria-pressed={!spaceView() && view() === 'list'} onClick={() => { setSpaceView(false); void setView('list'); }}><Icon name="text" /></HeaderButton>
          <HeaderButton variant="icon" aria-label="Space" aria-pressed={spaceView()} onClick={() => setSpaceView(true)}><Icon name="chart" /></HeaderButton>
          <Show when={filterCount() > 0}><HeaderButton onClick={resetFilters}>Reset</HeaderButton></Show>
        </HeaderActions>
      </PanelHeader>
      <div class={styles.body} hidden={isPanelCollapsed(ATTACHMENTS_PANEL)} style={{ display: isPanelCollapsed(ATTACHMENTS_PANEL) ? 'none' : undefined }}>
        <PlaceRail />
        <div class={styles.main}>
          <FilterBar />
          <Show when={selection.selecting() || compressionJob() || folderSaveJob()}><SelectionBar /></Show>
          <Show when={spaceView()}><SpaceView /></Show>
          <div class={styles.fileView} hidden={spaceView()} style={{ display: spaceView() ? 'none' : undefined }}>
            <Show when={failure()} fallback={<Show when={attachments.items.length === 0 && !attachments.loading}><p class={`cp-panel-empty ${styles.empty}`}>No attachments match these filters.</p></Show>}>
              <p class={`cp-panel-empty ${styles.empty}`} role="alert" title={failure()!}>Attachments couldn’t be read.</p>
            </Show>
            <Show when={view() === 'list'}><AttachmentListHeader /></Show>
            <div class={styles.scroller} data-anchor={topDown() ? 'top' : 'bottom'} ref={(el) => { vlog.ref(el); log.ref(el); }} onScroll={() => void vlog.onScroll()}>
              <div class={styles.measure} ref={measure} aria-hidden="true" />
              <VirtualRows log={vlog}>{(row) => (
                <Switch>
                  <Match when={row().kind === 'day' && row() as Extract<Row, { kind: 'day' }>}>
                    {(day) => <DayDivider label={day().label} />}
                  </Match>
                  <Match when={row().kind === 'items' && row() as Extract<Row, { kind: 'items' }>}>
                    {(group) => <Show when={view() === 'grid'} fallback={<AttachmentList item={group().items[0]!} />}>
                      <div class={styles.gridRow} style={{ '--cols': cols() }}><For each={group().items}>{(item) => <AttachmentGrid item={item} />}</For></div>
                    </Show>}
                  </Match>
                </Switch>
              )}</VirtualRows>
            </div>
            <Show when={!topDown() && !log.following()}><JumpToNewest label="Jump to newest attachment" onClick={() => { vlog.holdRow(null); log.scrollToNewest(); }} /></Show>
          </div>
        </div>
      </div>
    </section>
  );
}
