import { For, Show } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { CONVERSATION_GAP_MINUTES } from '../shared/conversations';
import { GRAPH_PEOPLE_MAX } from './graphInputs';
import { conversations, namesChannelId } from './state';
import { TalkGraph } from './TalkGraph';
import { Building, CountRows, SHARE_ROW, Subheading, countLabel, formatCount, share } from './section';
import styles from './Stats.module.css';
import { ConversationRoles } from './ConversationRoles';
import { PosterIdentity } from './PosterRow';

export function Conversations() {
  return <section class={styles.section} aria-label="Conversations" aria-busy={conversations.loading}>
    <Show when={conversations.failure}><p class="cp-error" role="alert">Couldn't load Conversations. {conversations.failure}</p></Show>
    <Show when={conversations.loading && !conversations()}><p class={look.text} data-size="sm" data-tone="muted" role="status">Loading Conversations…</p></Show>
    <Building label="Conversations" read={conversations.result()} loading={conversations.loading} />
    <Show when={conversations()}>{(stats) => <>
      <p class={look.text} data-size="xs" data-tone="muted">Read {countLabel(stats().messages, 'archived message')}. A conversation run ends after a {CONVERSATION_GAP_MINUTES}-minute lull within a channel.</p>
      <CountRows rows={[{ name: 'Conversation runs', count: stats().conversations }, { name: 'Runs with two or more people', count: stats().pairedConversations }]} />
      <ConversationRoles stats={stats().roles} channelId={namesChannelId()} />
      <Subheading>Talk graph</Subheading>
      <p class={look.text} data-size="xs" data-tone="muted">Up to {GRAPH_PEOPLE_MAX} people from the strongest pairs. A tie counts one person posting right after another in the same channel within {CONVERSATION_GAP_MINUTES} minutes.</p>
      <TalkGraph stats={stats()} channelId={namesChannelId()} />
      <Subheading>Who talks with whom</Subheading>
      <ol class={styles.list}>
        <For each={stats().pairs}>{(pair, index) => <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(pair.exchanges, stats().pairs[0]?.exchanges ?? 0)}>
          <span class={styles.rowLead}>
            <span class={styles.rowCount}>{formatCount(index() + 1)}.</span>
            <PosterIdentity poster={pair.first} channelId={namesChannelId()} />
            <span>and</span>
            <PosterIdentity poster={pair.second} channelId={namesChannelId()} />
          </span>
          <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{countLabel(pair.exchanges, 'exchange')}</span>
        </li>}</For>
      </ol>
      <Show when={!stats().pairs.length}><p class={look.text} data-size="sm" data-tone="muted">No exchanges in this range.</p></Show>
    </>}</Show>
  </section>;
}
