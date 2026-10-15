import { Show } from 'solid-js';
import { onCleanup } from '@plugin-sdk/renderer';
import { HeaderActions, HeaderButton, Icon, isPanelCollapsed, look, PanelHeader, personOption, SearchSelect, SectionSplit, Select, shownChannelId, type SectionDef } from '@plugin-sdk/renderer/kit';
import { personOptions, refreshStats, setStatsAuthor, setStatsRange, setStatsScope, setStatsSection, stats, statsAuthor, statsLoading, statsPanelMounted, statsRange, statsScope, statsSection } from './state';
import { STATS_RANGES, STATS_SCOPES, STATS_SECTIONS, type StatsRange, type StatsScope, type StatsSection } from '../shared/types';
import { STATS_PANEL } from '../shared';
import { Overview } from './Overview';
import { Messages } from './Messages';
import { People } from './People';
import { Channels } from './Channels';
import { Links } from './Links';
import { Timeline } from './Timeline';
import { Emoji } from './Emoji';
import { Words } from './Words';
import { Sentiment } from './Sentiment';
import { Conversations } from './Conversations';
import { countLabel } from './section';
import styles from './Stats.module.css';

const SECTION_VIEWS = {
  overview: Overview, messages: Messages, people: People, channels: Channels, links: Links, timeline: Timeline,
  emoji: Emoji, words: Words, sentiment: Sentiment, conversations: Conversations,
};

/** Analytics opens one section beside a caller-owned rail, with scope and range above it. */
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
          <HeaderButton variant="icon" aria-label="Refresh analytics" title="Refresh" disabled={statsLoading()} onClick={() => void refreshStats()}>
            <Icon name="refresh" />
          </HeaderButton>
        </HeaderActions>
      </PanelHeader>
      <Show when={!isPanelCollapsed(STATS_PANEL)}>
        <div class={`${styles.filters} ${look.ruleBelow}`}>
          <Select class={styles.select} label="Scope" value={statsScope()} options={Object.entries(STATS_SCOPES).map(([value, label]) => ({ value, label }))} onChange={(v) => setStatsScope(v as StatsScope)} />
          <Select class={styles.select} label="Date range" value={statsRange()} options={Object.entries(STATS_RANGES).map(([value, range]) => ({ value, label: range.label }))} onChange={(v) => setStatsRange(v as StatsRange)} />
          <SearchSelect class={styles.select} label="Person" value={statsAuthor() ?? ''} options={[
            { value: '', label: 'Everyone', lead: () => <Icon name="group" /> },
            ...(personOptions() ?? []).map((poster) => personOption({ userId: poster.userId, channelId: statsScope() === 'all' ? null : shownChannelId(), fallback: poster.name })),
          ]} onChange={(v) => setStatsAuthor(v || null)} />
        </div>
        <div class="cp-panel-body cp-settings-page" aria-busy={stats.loading}>
          <Show when={stats.failure}><p class="cp-error" role="alert">Couldn't load Analytics.</p></Show>
          <Show when={stats.loading && !stats()}><p class={look.text} data-size="md" data-tone="muted" role="status">Loading Analytics…</p></Show>
          <Show when={stats()}>{(s) => {
            const sections: SectionDef[] = Object.entries(STATS_SECTIONS).map(([id, label]) => {
              const View = SECTION_VIEWS[id as StatsSection];
              return { id, label, body: () => <View stats={s} /> };
            });
            return (
              <Show when={s().archivedSince !== null} fallback={<p class={look.text} data-size="md" data-tone="muted">{statsScope() !== 'all' && !shownChannelId() ? 'Open a channel to count it, or choose Everything.' : 'No archived messages in this scope.'}</p>}>
                <SectionSplit title="Analytics" sections={sections} openId={statsSection()} onOpen={(id) => setStatsSection(id as StatsSection)} />
              </Show>
            );
          }}</Show>
        </div>
      </Show>
    </section>
  );
}
