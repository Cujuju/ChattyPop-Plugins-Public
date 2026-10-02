// The Links panel (F2): the feed, oldest at the top, with its filter bar.
import { Match, Show, Switch, createEffect, createMemo, createSignal, on, onMount } from 'solid-js';
import {
  DayDivider,
  JumpToNewest,
  PanelHeader,
  VirtualRows,
  createFollowBottom,
  createVirtualLog,
  dayLabel,
  HeaderActions,
  HeaderBadge,
  HeaderButton,
  inCompanion,
  isPanelCollapsed,
  look,
} from '@plugin-sdk/renderer/kit';
import { LINKS_PANEL } from '../shared';
import type { LinkItem } from '../shared/types';
import {
  linkChannelId,
  linkCounts,
  linkDivider,
  linkFilterCount,
  linkHideFlagged,
  linkLoads,
  linkPlatforms,
  linkRange,
  links,
  linkSort,
  loadOlderLinks,
  newLinkCount,
  reloadLinks,
} from './state';
import { HeaderPlatformChips, LinkFilters } from './LinkFilters';
import { LinkFilterSheet } from './LinkFilterSheet';
import { LinkRow } from './LinkRow';
import styles from './Links.module.css';
import filterStyles from './LinkFilters.module.css';

/** A funnel of three shortening lines, on the icons' 24-unit grid. */
const FILTER_ICON_PATH = 'M4 7h16M7 12h10M10 17h4';

/** Row-height guess before measurement (share with preview); rows are measured after render. */
const ESTIMATED_ROW_PX = 120;
/** Load older links when the top is within this many rows. */
const LOAD_OLDER_THRESHOLD_ROWS = 20;

type Row = { kind: 'divider'; key: string } | { kind: 'day'; key: string; label: string } | { kind: 'link'; key: string; item: LinkItem };

/**
 * F2 Links: every shared link for the filter bar's filter and order, oldest at the top and the top one at the bottom,
 * paging older links in as you scroll up. "N new" counts links since the watermark; a "caught up" line marks where the
 * panel was last read up to.
 */
export function LinksPanel() {
  const log = createFollowBottom();
  const rows = createMemo<Row[]>(() => {
    // The caught-up line and day headings mark points in time: only meaningful in newest order.
    const chronological = linkSort() === 'newest';
    const divider = chronological ? linkDivider() : null;
    const out: Row[] = [];
    let lastDay = '';
    links.items.forEach((item, i) => {
      const prev = links.items[i - 1];
      if (divider !== null && prev && prev.ts <= divider && item.ts > divider) out.push({ kind: 'divider', key: 'caught-up' });
      const day = dayLabel(item.ts);
      if (chronological && day !== lastDay) out.push({ kind: 'day', key: `day-${item.id}`, label: day });
      lastDay = day;
      out.push({ kind: 'link', key: String(item.id), item });
    });
    return out;
  });
  const vlog = createVirtualLog({
    rows,
    estimatePx: ESTIMATED_ROW_PX,
    olderThresholdRows: LOAD_OLDER_THRESHOLD_ROWS,
    loadOlder: loadOlderLinks,
    following: log.following,
    // A runway above the oldest link while older ones remain, so a fling runs on as they load.
    hasOlder: () => !links.reachedStart,
  });

  // Any filter change reloads; every reload lands on the newest link.
  onMount(() => void reloadLinks());
  createEffect(on([linkPlatforms, linkChannelId, linkRange, linkSort, linkHideFlagged], () => void reloadLinks(), { defer: true }));
  createEffect(on(linkLoads, () => queueMicrotask(log.scrollToNewest)));

  const [sheetOpen, setSheetOpen] = createSignal(false);
  const filterLabel = (): string => (linkFilterCount() ? `Filters, ${linkFilterCount()} set` : 'Filters');

  return (
    // Structural geometry inline: the body is relative for the jump button; the scroller owns the remaining height for virtualization.
    <section class="cp-panel" aria-label="Links">
      <PanelHeader section={LINKS_PANEL} collapsible title="Links">
        <Show when={newLinkCount() > 0}>
          <HeaderBadge>{newLinkCount()} new</HeaderBadge>
        </Show>
        {/* The phone's filters are in the header: the platforms as icon chips, the rest in a sheet whose button is raised while any is set. */}
        <Show when={inCompanion}>
          <HeaderPlatformChips counts={linkCounts()} />
          <HeaderActions>
            <HeaderButton variant="icon" aria-label={filterLabel()} aria-haspopup="dialog" aria-pressed={linkFilterCount() > 0} onClick={() => setSheetOpen(true)}>
              <svg class={`${filterStyles.headerIcon} ${look.lineIcon}`} viewBox="0 0 24 24" aria-hidden="true">
                <path d={FILTER_ICON_PATH} />
              </svg>
            </HeaderButton>
          </HeaderActions>
        </Show>
      </PanelHeader>
      <Show when={inCompanion}>
        <LinkFilterSheet open={sheetOpen()} onClose={() => setSheetOpen(false)} />
      </Show>
      {/* Folded, the body is hidden rather than unmounted: the virtualizer keeps its scroll element. */}
      <div
        hidden={isPanelCollapsed(LINKS_PANEL)}
        style={{
          display: isPanelCollapsed(LINKS_PANEL) ? 'none' : 'flex',
          'flex-direction': 'column',
          flex: '1 1 0',
          'min-height': 0,
          position: 'relative',
        }}
      >
        <Show when={!inCompanion}>
          <LinkFilters counts={linkCounts()} />
        </Show>
        <Show when={links.items.length === 0 && !links.loading}>
          <p class="cp-panel-empty">No links match these filters.</p>
        </Show>
        <div
          class={styles.list}
          ref={(el) => {
            vlog.ref(el);
            log.ref(el);
          }}
          onScroll={() => void vlog.onScroll()}
          style={{ flex: '1 1 0', 'min-height': 0, 'overflow-y': 'auto' }}
        >
          <VirtualRows log={vlog}>
            {(row) => (
              <Switch>
                {/* Rows show only the time, as in the Archive: a heading starts each day (newest order). */}
                <Match when={row().kind === 'link' && (row() as Extract<Row, { kind: 'link' }>)}>
                  {(r) => <LinkRow item={r().item} dated={linkSort() !== 'newest'} />}
                </Match>
                <Match when={row().kind === 'day' && (row() as Extract<Row, { kind: 'day' }>)}>
                  {(r) => <DayDivider label={r().label} />}
                </Match>
                <Match when={row().kind === 'divider'}>
                  <div
                    class={`${styles.watermark} ${look.labelledRule} ${look.text}`}
                    data-size="2xs"
                    data-weight="semibold"
                    data-case="upper"
                    data-tracking="label"
                    data-tone="section"
                    role="separator"
                  >
                    caught up
                  </div>
                </Match>
              </Switch>
            )}
          </VirtualRows>
        </div>
        <Show when={!log.following()}>
          <JumpToNewest label="Jump to newest link" onClick={log.scrollToNewest} />
        </Show>
      </div>
    </section>
  );
}
