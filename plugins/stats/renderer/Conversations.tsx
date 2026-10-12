import { For, Show } from 'solid-js';
import { PersonName, look, shownChannelId } from '@plugin-sdk/renderer/kit';
import { CONVERSATION_GAP_MINUTES } from '../shared/conversations';
import { GRAPH_PEOPLE_MAX } from './graphInputs';
import { conversations } from './state';
import { TalkGraph } from './TalkGraph';
import { CountRows, SHARE_ROW, Subheading, countLabel, formatCount, share } from './section';
import styles from './Stats.module.css';

export function Conversations() {
  const personChannel = () => conversations()?.query.scope === 'all' ? null : shownChannelId();
  return <section class={styles.section} aria-label="Conversations" aria-busy={conversations.loading}>
    <Show when={conversations.failure}><p class="cp-error" role="alert">Couldn't load Conversations. {conversations.failure}</p></Show>
    <Show when={conversations.loading && !conversations()}><p class={look.text} data-size="sm" data-tone="muted" role="status">Loading Conversations…</p></Show>
    <Show when={conversations()}>{(stats) => <>
      <p class={look.text} data-size="xs" data-tone="muted">Read {countLabel(stats().messages, 'archived message')}. A conversation run ends after a {CONVERSATION_GAP_MINUTES}-minute lull within a channel.</p>
      <CountRows rows={[{ name: 'Conversation runs', count: stats().conversations }, { name: 'Runs with two or more people', count: stats().pairedConversations }]} />
      <Subheading>Talk graph</Subheading>
      <p class={look.text} data-size="xs" data-tone="muted">Up to {GRAPH_PEOPLE_MAX} people from the strongest pairs. Sharing a run does not establish a direct reply.</p>
      <TalkGraph stats={stats()} channelId={personChannel()} />
      <Subheading>Who talks with whom</Subheading>
      <ol class={styles.list}>
        <For each={stats().pairs}>{(pair, index) => <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(pair.count, stats().pairs[0]?.count ?? 0)}>
          <span class={styles.rowLead}>
            <span class={styles.rowCount}>{formatCount(index() + 1)}.</span>
            <PersonName userId={pair.first.userId} channelId={personChannel()} fallback={pair.first.name} />
            <span>and</span>
            <PersonName userId={pair.second.userId} channelId={personChannel()} fallback={pair.second.name} />
          </span>
          <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{formatCount(pair.count)}</span>
        </li>}</For>
      </ol>
    </>}</Show>
  </section>;
}
