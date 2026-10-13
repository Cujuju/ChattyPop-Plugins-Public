import { For } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { REPLY_MIN_RUNS, type ConversationRoles as Roles } from '../shared/conversations';
import { PosterIdentity, PosterRow } from './PosterRow';
import { SHARE_ROW, Subheading, countLabel } from './section';
import { formatReplyDelay } from './replyDelay';
import styles from './Stats.module.css';

export function ConversationRoles(props: { stats: Roles; channelId: string | null }) {
  return <>
    <p class={look.text} data-size="xs" data-tone="muted">Roles count only runs with at least two different authors. Reply times start at the opening message.</p>
    <For each={['starts', 'closes'] as const}>{(key) => <>
      <Subheading>{key === 'starts' ? 'Starts conversations' : 'Has the last word'}</Subheading>
      <ol class={styles.list}>
        <For each={props.stats[key]}>{(person, index) => <PosterRow poster={person} channelId={props.channelId} rank={index() + 1}
          max={props.stats[key][0]?.count ?? 0} value={countLabel(person.count, 'run')} />}</For>
      </ol>
    </>}</For>
    <Subheading>Time to first reply</Subheading>
    <p class={look.text} data-size="sm">{props.stats.medianReplyMs === null ? 'No replies in this range.' : `${formatReplyDelay(props.stats.medianReplyMs)} median`}</p>
    <Subheading>Gets replies fastest</Subheading>
    <p class={look.text} data-size="xs" data-tone="muted">Median time to the first different-author reply, among people who opened at least {REPLY_MIN_RUNS} runs with replies.</p>
    <ol class={styles.list}>
      <For each={props.stats.fastest}>{(person, index) => <li class={`${styles.row} ${look.text}`} {...SHARE_ROW}>
        <PosterIdentity poster={person} channelId={props.channelId} rank={index() + 1} />
        <span class={styles.rowCount} title={countLabel(person.count, 'run with a reply', 'runs with replies')}>{formatReplyDelay(person.medianReplyMs)}</span>
      </li>}</For>
    </ol>
  </>;
}
