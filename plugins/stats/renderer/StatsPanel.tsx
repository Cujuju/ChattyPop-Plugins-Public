import { For, Show, onCleanup } from 'solid-js';
import { countText, HeaderActions, HeaderButton, isPanelCollapsed, look, openPerson, PanelHeader, Select, shownChannelId } from '@plugin-sdk/renderer/kit';
import { refreshStats, setStatsRange, setStatsScope, stats, statsPanelMounted, statsRange, statsScope } from './state';
import { STATS_RANGES, STATS_SCOPES, type StatsRange, type StatsScope } from '../shared/types';
import { STATS_PANEL } from '../shared';
import styles from './Stats.module.css';

/** Heatmap rows, Monday first; values are JavaScript weekdays (0 = Sunday). */
const WEEK_ROWS = [1, 2, 3, 4, 5, 6, 0];
/** 2026-01-04 was a Sunday: a reference date for weekday names in the owner's locale. */
const SUNDAY = new Date(2026, 0, 4);
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const weekdayName = (wd: number): string => WEEKDAY.format(new Date(SUNDAY.getFullYear(), SUNDAY.getMonth(), SUNDAY.getDate() + wd));
/** Hours labelled under the heatmap. */
const HOUR_TICKS = [0, 6, 12, 18];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** A bar or cell's share of the largest value, for CSS (--v, 0–1). */
const share = (n: number, max: number): Record<string, string> => ({ '--v': String(max ? n / max : 0) });
/** A section heading: the uppercase micro label. */
const HEADING = { 'data-size': '2xs', 'data-weight': 'medium', 'data-case': 'upper', 'data-tracking': 'label', 'data-tone': 'muted' } as const;
/** Chart labels: muted micro text. */
const CHART_LABEL = { 'data-size': '2xs', 'data-tone': 'muted' } as const;
/** A ranked row's text. */
const SHARE_ROW = { 'data-size': 'sm', 'data-tone': 'primary' } as const;

/** #85: message counts over time, by weekday and hour, top posters and link domains, for the shown channel or wider. No AI. */
export function StatsPanel() {
  onCleanup(statsPanelMounted());
  const maxBucket = () => Math.max(0, ...(stats()?.buckets.map((b) => b.count) ?? []));
  const maxCell = () => Math.max(0, ...(stats()?.heatmap.flat() ?? []));
  const maxPoster = () => stats()?.posters[0]?.count ?? 0;
  const maxDomain = () => stats()?.domains[0]?.count ?? 0;
  return (
    <section class="cp-panel" aria-label="Activity" data-section="stats">
      <PanelHeader
        section="stats"
        collapsible
        title="Activity"
        meta={stats() ? `${countText(stats()!.messages, 'message')} · ${countText(stats()!.authors, 'person', 'people')}` : undefined}
      >
        <HeaderActions>
          <HeaderButton disabled={stats.loading} onClick={() => void refreshStats()}>
            Refresh
          </HeaderButton>
        </HeaderActions>
      </PanelHeader>
      <Show when={!isPanelCollapsed(STATS_PANEL)}>
        <div class={`${styles.filters} ${look.ruleBelow}`}>
          <Select class={styles.select} label="Scope" value={statsScope()} options={Object.entries(STATS_SCOPES).map(([value, label]) => ({ value, label }))} onChange={(v) => setStatsScope(v as StatsScope)} />
          <Select class={styles.select} label="Date range" value={statsRange()} options={Object.entries(STATS_RANGES).map(([value, r]) => ({ value, label: r.label }))} onChange={(v) => setStatsRange(v as StatsRange)} />
        </div>
        <div class={`cp-panel-body ${styles.body}`}>
          <Show when={stats.failure}>
            <p class="cp-error" role="alert">
              Couldn't count activity.
            </p>
          </Show>
          <Show when={stats()}>
            {(s) => (
              <Show when={s().messages} fallback={<p class={look.text} data-size="md" data-tone="muted">{statsScope() !== 'all' && !shownChannelId() ? 'Open a channel to count it, or choose Everything.' : 'No messages in this range.'}</p>}>
                <h3 class={`${styles.heading} ${look.text}`} {...HEADING}>Messages per {s().bucket}</h3>
                <div class={`${styles.bars} ${look.ruleBelow}`} role="img" aria-label={`Messages per ${s().bucket}, ${s().buckets.length} bars`}>
                  <For each={s().buckets}>{(b) => <span class={`${styles.bar} ${look.chartBar}`} style={share(b.count, maxBucket())} title={`${b.start}: ${countText(b.count, 'message')}`} />}</For>
                </div>
                <div class={`${styles.axis} ${look.text}`} {...CHART_LABEL}>
                  <span>{s().buckets[0]?.start}</span>
                  <span>{s().buckets.at(-1)?.start}</span>
                </div>

                <h3 class={`${styles.heading} ${look.text}`} {...HEADING}>By weekday and hour</h3>
                <div class={styles.heatmap} role="img" aria-label="Messages by weekday and hour">
                  <For each={WEEK_ROWS}>
                    {(wd) => (
                      <>
                        <span class={`${styles.dayLabel} ${look.text}`} {...CHART_LABEL}>{weekdayName(wd)}</span>
                        <For each={HOURS}>{(h) => <span class={`${styles.cell} ${look.heatCell}`} style={share(s().heatmap[wd]![h]!, maxCell())} title={`${weekdayName(wd)} ${h}:00 · ${countText(s().heatmap[wd]![h]!, 'message')}`} />}</For>
                      </>
                    )}
                  </For>
                  <span />
                  <For each={HOURS}>{(h) => <span class={look.text} {...CHART_LABEL}>{HOUR_TICKS.includes(h) ? h : ''}</span>}</For>
                </div>

                <h3 class={`${styles.heading} ${look.text}`} {...HEADING}>Top posters</h3>
                <ul class={styles.list}>
                  <For each={s().posters}>
                    {(p) => (
                      <li>
                        <button type="button" class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(p.count, maxPoster())} title="Open their Person window" onClick={() => openPerson(p.userId)}>
                          <span class={styles.rowName}>{p.name}</span>
                          <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{p.count}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>

                <Show when={s().domains.length}>
                  <h3 class={`${styles.heading} ${look.text}`} {...HEADING}>Top link domains</h3>
                  <ul class={styles.list}>
                    <For each={s().domains}>
                      {(d) => (
                        <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(d.count, maxDomain())}>
                          <span class={styles.rowName}>{d.domain}</span>
                          <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{d.count}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}
