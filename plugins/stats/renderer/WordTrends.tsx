import { For, Show, createMemo, createSignal } from 'solid-js';
import { look, shortDateTime } from '@plugin-sdk/renderer/kit';
import { WORD_TREND_MIN_USES, WORD_RATE_BASE, wordStrip, type WordTrends as Trends } from '../shared/wordTrends';
import { SHARE_ROW, Subheading, share } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';

/** One decimal distinguishes small per-thousand changes without overcrowding list rows. */
const RATE_DIGITS = 1;
const RATE = new Intl.NumberFormat(undefined, { maximumFractionDigits: RATE_DIGITS });

export function WordTrends(props: { stats: Trends }) {
  const [selection, select] = createSignal('');
  const chosen = () => props.stats.choices.includes(selection()) ? selection() : props.stats.choices[0] ?? '';
  const rates = createMemo(() => wordStrip(props.stats.buckets, chosen()));
  const max = () => Math.max(0, ...rates());
  return <>
    <p class={look.text} data-size="xs" data-tone="muted">Rising and fading compare uses per {WORD_RATE_BASE} words before and from the text midpoint
      {props.stats.midpointTs !== null ? ` (${shortDateTime(props.stats.midpointTs)})` : ''}. At least {WORD_TREND_MIN_USES} total uses; the Top words filters apply.</p>
    <For each={['rising', 'fading'] as const}>{(key) => <>
      <Subheading>{key === 'rising' ? 'Rising' : 'Fading'}</Subheading>
      <ol class={styles.list}>
        <For each={props.stats[key]}>{(row) => <li class={`${styles.row} ${look.text}`} {...SHARE_ROW}>
          <span class={styles.rowName}>{row.word}</span>
          <span class={styles.rowCount}>{RATE.format(row.earlierRate)} → {RATE.format(row.laterRate)} uses per {WORD_RATE_BASE} words</span>
        </li>}</For>
      </ol>
      <Show when={!props.stats[key].length}><p class={look.text} data-size="sm" data-tone="muted">No qualifying {key} words.</p></Show>
    </>}</For>
    <Subheading>Trend</Subheading>
    <div class={styles.choices} aria-label="Choose a word">
      <For each={props.stats.choices}>{(word) => <button type="button" class={look.chip} aria-pressed={chosen() === word} onClick={() => select(word)}>{word}</button>}</For>
    </div>
    <Show when={chosen()} fallback={<p class={look.text} data-size="sm" data-tone="muted">No words to chart in this range.</p>}>
      <p class={look.text} data-size="xs" data-tone="muted">{chosen()}: uses per {WORD_RATE_BASE} words per {props.stats.bucket}, relative to its highest bucket.</p>
      <div class={styles.strip} role="img" aria-label={`${chosen()} uses per ${WORD_RATE_BASE} words per ${props.stats.bucket}`}>
        <For each={props.stats.buckets}>{(bucket, index) => <span class={`${styles.bar} ${look.chartBar}`} style={share(rates()[index()] ?? 0, max())}
          title={`${formatPeriod(bucket.start, 'day')}: ${RATE.format(rates()[index()] ?? 0)} uses of ${chosen()} per ${WORD_RATE_BASE} words, ${bucket.totalWords ? `${bucket.counts[chosen()] ?? 0} uses in ${bucket.totalWords} words` : 'no words in the scope'}`} />}</For>
      </div>
    </Show>
  </>;
}
