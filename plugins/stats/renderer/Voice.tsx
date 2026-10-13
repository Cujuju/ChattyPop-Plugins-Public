import { For, Show } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { VOICE_PEOPLE, voiceShare } from '../shared/voice';
import { people, statsAuthor } from './state';
import { PosterIdentity } from './PosterRow';
import { Subheading, countLabel, share } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';

/** Two decimal places keep small message shares visible in bucket descriptions. */
const SHARE_DIGITS = 2;
const PERCENT = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: SHARE_DIGITS });

export function Voice(props: { channelId: string | null }) {
  const voice = () => people()?.voice;
  return <>
    <Subheading>Share of voice</Subheading>
    <p class={look.text} data-size="xs" data-tone="muted">{statsAuthor() === null ? `Top ${VOICE_PEOPLE} posters in this range. Every strip uses the same highest-share scale.` : "This person's share of all messages in the scope and range. Buckets include everyone's messages."}</p>
    <Show when={people.failure}><p class="cp-error" role="alert">Couldn't load share of voice. {people.failure}</p></Show>
    <Show when={people.loading && !voice()}><p class={look.text} data-size="sm" data-tone="muted" role="status">Loading share of voice…</p></Show>
    <Show when={voice()}>{(stats) => <ul class={styles.multiples} aria-busy={people.loading}>
      <For each={stats().people}>{(person) => <li class={`${styles.multiple} ${look.text}`} data-size="sm">
        <PosterIdentity poster={person.poster} channelId={props.channelId} />
        <div class={styles.strip} role="img" aria-label={`${person.poster.name}'s share of messages per ${stats().bucket}`}>
          <For each={stats().buckets}>{(bucket, index) => <span class={`${styles.bar} ${look.chartBar}`}
            style={share(voiceShare(person.counts[index()] ?? 0, bucket.count), stats().maxShare)}
            title={`${formatPeriod(bucket.start, 'day')}: ${bucket.count ? `${PERCENT.format(voiceShare(person.counts[index()] ?? 0, bucket.count))} of messages, ${countLabel(person.counts[index()] ?? 0, 'message')} out of ${countLabel(bucket.count, 'message')}` : 'no messages in the scope'}`} />}</For>
        </div>
      </li>}</For>
      <Show when={!stats().people.length}><li class={look.text} data-size="sm" data-tone="muted">No messages in this range.</li></Show>
    </ul>}</Show>
  </>;
}
