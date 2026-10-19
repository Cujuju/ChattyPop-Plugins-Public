import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onMount } from 'solid-js';
import { onCleanup } from '@plugin-sdk/renderer';
import { DayDivider, HeaderActions, HeaderButton, HeaderMeta, Icon, JumpToNewest, PanelHeader, PlaceRail, VirtualRows, createFollowBottom, createVirtualLog, dayLabel, formatBytes, isPanelCollapsed, isThread, type PlaceCounts } from '@plugin-sdk/renderer/kit';
import { ATTACHMENTS_PANEL } from '../shared';
import {
  attachments, failure, filterCount, hasMoreBelow, loadMoreBelow, loadOlderAttachments, loads, reloadAttachments, resetFilters, setView, sort, topDown,
  totals, view, jumped, refreshAttachmentAggregates,
  spaceView, setSpaceView,
  channelsHidden, places, setChannelsHidden, setWhere, where,
} from './state';
import { compressionJob, selection } from './selection';
import { attachmentGallery, filesCount, openAttachment, showItemMenu } from './actions';
import { createAttachmentKeyboard } from './keyboard';
import type { Direction } from './gallery';
import { FilterBar, HeaderTools } from './AttachmentFilters';
import { AttachmentGrid } from './AttachmentGrid';
import { AttachmentList, AttachmentListHeader } from './AttachmentList';
import { cutRows, type Row } from './rows';
import { SelectionBar } from './SelectionBar';
import { SpaceView } from './SpaceView';
import { PostingsHost } from './PostingsPopover';
import { folderSaveJob } from './folderSave';
import styles from './Attachments.module.css';

const LOAD_OLDER_THRESHOLD_ROWS = 10;
const INITIAL_TRACK_COUNT = 1;
const INITIAL_ESTIMATE_PX = 1;

/** The rail's files per place, under every filter but the place. */
const placeFiles: PlaceCounts = {
  guild: (id) => places().guilds[id] ?? 0,
  channel: (id) => places().channels[id] ?? places().threads[id] ?? 0,
  total: () => Object.values(places().guilds).reduce((sum, n) => sum + n, 0),
  label: filesCount,
};

export function AttachmentsPanel() {
  const [cols, setCols] = createSignal(INITIAL_TRACK_COUNT);
  const [trackWidth, setTrackWidth] = createSignal(INITIAL_ESTIMATE_PX);
  let measure!: HTMLDivElement;
  let scroller!: HTMLDivElement;
  let panel: HTMLElement | undefined;
  /** The window's first file in the order, set as it opens; rows are cut from it (cutRows). */
  const [origin, setOrigin] = createSignal<string | null>(null);
  const rows = createMemo<Row[]>(() => cutRows(attachments.items, { count: view() === 'grid' ? cols() : 1, origin: origin(),
    startAtTop: topDown(), dayOf: sort().key === 'date' ? (item) => dayLabel(item.ts) : null }));
  const vlog = createVirtualLog({ rows, estimatePx: () => trackWidth(), olderThresholdRows: LOAD_OLDER_THRESHOLD_ROWS,
    loadOlder: loadOlderAttachments, hasOlder: () => !attachments.reachedStart, hasNewer: hasMoreBelow, loadNewer: loadMoreBelow,
    // Top-down, the view stays where the reader put it as more loads below.
    following: () => !topDown() && !jumped() && log.following(),
    layoutKey: () => `${view()}:${cols()}:${trackWidth()}`,
  });
  const log = createFollowBottom(() => vlog.holding());
  const itemRows = () => rows().flatMap((row) => row.kind === 'items' ? [row.items.map((item) => item.id)] : []);
  const scroll = (id: string): void => {
    const row = rows().find((row) => row.kind === 'items' && row.items.some((item) => item.id === id));
    if (row) vlog.scrollToKey(row.key);
  };
  const more = (direction: Direction): boolean => direction < 0 ? !attachments.reachedStart : hasMoreBelow();
  const load = (direction: Direction): Promise<number> => direction < 0 ? loadOlderAttachments() : loadMoreBelow();
  const gallery = attachmentGallery({ items: () => attachments.items, more, load, scroll,
    start: () => topDown() ? -1 : 1, closed: (id) => keyboard.focus(id) });
  const keyboard = createAttachmentKeyboard({ rows: itemRows,
    visible: () => {
      const visible = new Set(vlog.log.keys());
      return rows().flatMap((row) => visible.has(row.key) && row.kind === 'items' ? row.items.map((item) => item.id) : []);
    },
    pageRows: () => {
      const row = scroller?.querySelector<HTMLElement>('[data-attachment-id]');
      const height = row?.closest<HTMLElement>('[data-row-key]')?.offsetHeight || trackWidth();
      return Math.max(INITIAL_TRACK_COUNT, Math.floor((scroller?.clientHeight ?? height) / height));
    },
    grid: () => view() === 'grid', scroll, more, load, selection, open: (item) => openAttachment(item, gallery.open),
    menu: (anchor, item) => showItemMenu(anchor, item, selection, gallery.open),
  });
  createEffect(() => { attachments.items.map((item) => [item.id, item.sha256, item.status, item.storedExt]); gallery.sync(); });
  onCleanup(() => { gallery.dispose(); keyboard.dispose(); });
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
    vlog.holdRow(null);
    const groups = rows().filter((r) => r.kind === 'items');
    const first = topDown() ? groups[0] : groups.at(-1);
    if (!topDown()) log.scrollToNewest();
    // A row above the view comes in at its top edge.
    else if (first) vlog.scrollToKey(first.key);
    if (jumped() && first) {
      vlog.holdRow(first.key, topDown() ? 'auto' : { bottom: 0 });
      const opened = loads();
      // A short window can already be visible at the bottom; align its measured first row to the reading edge.
      queueMicrotask(() => {
        if (!jumped() || opened !== loads() || !topDown()) return;
        const row = scroller.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(first.key)}"]`);
        if (row) vlog.holdRow(first.key, { bottom: scroller.clientHeight - row.getBoundingClientRect().height });
      });
    }
  };
  createEffect(on(loads, () => {
    setOrigin((topDown() ? attachments.items[0] : attachments.items.at(-1))?.id ?? null);
    queueMicrotask(toStart);
  }));
  return (
    <section ref={panel} class="cp-panel" aria-label="Attachments" on:keydown={(e) => { if (e.key === 'Escape') selection.done(); }}>
      <PanelHeader section={ATTACHMENTS_PANEL} collapsible title="Attachments">
        <HeaderMeta>{filesCount(totals().count)} · {formatBytes(totals().bytes)}</HeaderMeta>
        <HeaderTools />
        <HeaderActions>
          <HeaderButton aria-pressed={selection.selecting()} title="Pick files to save, compress or delete" onClick={() => selection.selecting() ? selection.done() : selection.start()}>Select</HeaderButton>
          <HeaderButton variant="icon" aria-label="Grid view" aria-pressed={!spaceView() && view() === 'grid'} onClick={() => { setSpaceView(false); void setView('grid'); }}><Icon name="apps" /></HeaderButton>
          <HeaderButton variant="icon" aria-label="List view" aria-pressed={!spaceView() && view() === 'list'} onClick={() => { setSpaceView(false); void setView('list'); }}><Icon name="text" /></HeaderButton>
          <HeaderButton variant="icon" aria-label="Space" aria-pressed={spaceView()} onClick={() => setSpaceView(true)}><Icon name="chart" /></HeaderButton>
          <Show when={filterCount() > 0}><HeaderButton onClick={resetFilters}>Reset</HeaderButton></Show>
          <RollupControls onRebuilt={refreshAttachmentAggregates} />
        </HeaderActions>
      </PanelHeader>
      <div class={styles.body} hidden={isPanelCollapsed(ATTACHMENTS_PANEL)} style={{ display: isPanelCollapsed(ATTACHMENTS_PANEL) ? 'none' : undefined }}>
        <PlaceRail place={where()} onPlace={setWhere} channelsHidden={channelsHidden()} onChannelsHidden={(hidden) => void setChannelsHidden(hidden)}
          listsGuild={(g) => !!places().guilds[g.id]} listsChannel={(c) => !!(isThread(c) ? places().threads[c.id] : places().channels[c.id])}
          counts={placeFiles} allServers />
        <div class={styles.main}>
          <FilterBar />
          <Show when={selection.selecting() || compressionJob() || folderSaveJob()}><SelectionBar /></Show>
          <Show when={spaceView()}><SpaceView /></Show>
          <div class={styles.fileView} hidden={spaceView()}>
            <Show when={failure()} fallback={<Show when={attachments.items.length === 0 && !attachments.loading}><p class={`cp-panel-empty ${styles.empty}`}>No attachments match these filters.</p></Show>}>
              <p class={`cp-panel-empty ${styles.empty}`} role="alert" title={failure()!}>Attachments couldn’t be read.</p>
            </Show>
            <Show when={view() === 'list'}><AttachmentListHeader /></Show>
            <div class={styles.scroller} data-anchor={topDown() ? 'top' : 'bottom'} ref={(el) => { scroller = el; vlog.ref(el); log.ref(el); }} onScroll={() => void vlog.onScroll()}>
              <div class={styles.measure} ref={measure} aria-hidden="true" />
              <VirtualRows log={vlog} rowFocus={false} class={styles.canvas}>{(row) => (
                <Switch>
                  <Match when={row().kind === 'day' && row() as Extract<Row, { kind: 'day' }>}>
                    {(day) => <DayDivider label={day().label} />}
                  </Match>
                  <Match when={row().kind === 'items' && row() as Extract<Row, { kind: 'items' }>}>
                    {(group) => <Show when={view() === 'grid'} fallback={<AttachmentList item={group().items[0]!} keyboard={keyboard} openGallery={gallery.open} />}>
                      <div class={styles.gridRow} style={{ '--cols': cols() }}><For each={group().items}>{(item) => <AttachmentGrid item={item} keyboard={keyboard} openGallery={gallery.open} />}</For></div>
                    </Show>}
                  </Match>
                </Switch>
              )}</VirtualRows>
            </div>
            <Show when={jumped() || (!topDown() && !log.following())}>
              <JumpToNewest label={sort().key === 'date' && sort().dir === 'desc' ? 'Jump to newest attachment' : 'Jump to first attachment'}
                onClick={() => { vlog.holdRow(null); if (jumped()) void reloadAttachments(); else toStart(); }} />
            </Show>
          </div>
          <PostingsHost surface={() => panel} />
        </div>
      </div>
    </section>
  );
}
import { RollupControls } from './RollupControls';
