import { For } from 'solid-js';
import { PersonName, look, openArchiveAt, personName } from '@plugin-sdk/renderer/kit';
import { MESSAGE_WORD_BUCKETS, WORDS_PERSON_MIN_MESSAGES, type MessageLengthStats } from '../shared/messageLength';
import { PosterRow } from './PosterRow';
import { CountRows, SHARE_ROW, Subheading, countLabel } from './section';
import { formatTimestamp } from './periods';
import styles from './Stats.module.css';

/** One decimal retains useful differences between average message lengths. */
const AVERAGE_DECIMALS = 1;
const AVERAGE = new Intl.NumberFormat(undefined, { maximumFractionDigits: AVERAGE_DECIMALS });
export const formatAverage = (value: number): string => AVERAGE.format(value);

export function MessageLength(props: { stats: MessageLengthStats; channelId: string | null }) {
  return <>
    <Subheading>Message length</Subheading>
    <CountRows rows={props.stats.distribution.map((bucket) => ({
      name: MESSAGE_WORD_BUCKETS.find((b) => b.id === bucket.id)!.label, count: bucket.count,
    }))} />
    <p class={look.text} data-size="xs" data-tone="muted">
      Averages and median include {countLabel(props.stats.zeroWordMessages, 'text message')} with no word tokens; the buckets show messages with words.
    </p>
    <Subheading>Longest messages</Subheading>
    <ol class={styles.list}>
      <For each={props.stats.longest}>{(message) => <li class={`${styles.row} ${look.text}`} {...SHARE_ROW}>
        <span class={styles.posterIdentity}><PersonName userId={message.userId} channelId={message.channelId} fallback={message.userId} class={styles.rowName} /></span>
        <button type="button" class={`${styles.rowCount} ${look.quietLink}`} title="Open archived message"
          onClick={() => void openArchiveAt({ channelId: message.channelId, messageId: message.messageId, bottom: 0 })}>
          {countLabel(message.words, 'word')} · {formatTimestamp(message.ts)}
        </button>
      </li>}</For>
    </ol>
    <Subheading>Words per person</Subheading>
    <p class={look.text} data-size="xs" data-tone="muted">Average words per message, among people with at least {WORDS_PERSON_MIN_MESSAGES} text messages.</p>
    <ol class={styles.list}>
      <For each={props.stats.people}>{(person, index) => <PosterRow
        poster={{ userId: person.userId, name: personName(person.userId, props.channelId)?.name ?? person.userId, avatar: null, count: person.averageWords }}
        channelId={props.channelId} rank={index() + 1} max={props.stats.people[0]?.averageWords ?? 0}
        value={formatAverage(person.averageWords)} title={countLabel(person.textMessages, 'text message')} />}</For>
    </ol>
  </>;
}
