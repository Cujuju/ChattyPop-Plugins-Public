import { Show, onCleanup } from 'solid-js';
import { HeaderActions, HeaderButton, isPanelCollapsed, look, PanelHeader, Select, shownChannelId } from '@plugin-sdk/renderer/kit';
import { refreshStats, setStatsRange, setStatsScope, stats, statsPanelMounted, statsRange, statsScope } from './state';
import { STATS_RANGES, STATS_SCOPES, type StatsRange, type StatsScope } from '../shared/types';
import { STATS_PANEL } from '../shared';
import { Overview } from './Overview';
import { Messages } from './Messages';
import { People } from './People';
import { Channels } from './Channels';
import { Links } from './Links';
import { Timeline } from './Timeline';
import { countLabel } from './section';
import styles from './Stats.module.css';

/** Analytics stacks independently mountable sections in the panel's scrolling body. */
export function StatsPanel() {
  onCleanup(statsPanelMounted());
  return (
    <section class="cp-panel" aria-label="Analytics" data-section="stats">
      <PanelHeader
        section="stats"
        collapsible
        title="Analytics"
        meta={stats() ? `${countLabel(stats()!.messages, 'message')} · ${countLabel(stats()!.authors, 'person', 'people')}` : undefined}
      >
        <HeaderActions>
          <HeaderButton disabled={stats.loading} onClick={() => void refreshStats()}>Refresh</HeaderButton>
        </HeaderActions>
      </PanelHeader>
      <Show when={!isPanelCollapsed(STATS_PANEL)}>
        <div class={`${styles.filters} ${look.ruleBelow}`}>
          <Select class={styles.select} label="Scope" value={statsScope()} options={Object.entries(STATS_SCOPES).map(([value, label]) => ({ value, label }))} onChange={(v) => setStatsScope(v as StatsScope)} />
          <Select class={styles.select} label="Date range" value={statsRange()} options={Object.entries(STATS_RANGES).map(([value, range]) => ({ value, label: range.label }))} onChange={(v) => setStatsRange(v as StatsRange)} />
        </div>
        <div class={`cp-panel-body ${styles.body}`} aria-busy={stats.loading}>
          <Show when={stats.failure}><p class="cp-error" role="alert">Couldn't load Analytics.</p></Show>
          <Show when={stats.loading && !stats()}><p class={look.text} data-size="md" data-tone="muted" role="status">Loading Analytics…</p></Show>
          <Show when={stats()}>{(s) => (
            <Show when={s().messages} fallback={<p class={look.text} data-size="md" data-tone="muted">{statsScope() !== 'all' && !shownChannelId() ? 'Open a channel to count it, or choose Everything.' : 'No messages in this range.'}</p>}>
              <Overview stats={s} />
              <Messages stats={s} />
              <People stats={s} />
              <Channels stats={s} />
              <Links stats={s} />
              <Timeline stats={s} />
            </Show>
          )}</Show>
        </div>
      </Show>
    </section>
  );
}
