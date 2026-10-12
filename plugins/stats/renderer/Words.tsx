import { For } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { MIN_WORD_LENGTH, RANKED_WORDS } from '../shared/text';
import { words } from './state';
import { TextSection } from './TextSection';
import { WordCloud } from './WordCloud';
import { SHARE_ROW, Subheading, formatCount, share } from './section';
import styles from './Stats.module.css';

const AVERAGE_DECIMALS = 1;
const AVERAGE = new Intl.NumberFormat(undefined, { maximumFractionDigits: AVERAGE_DECIMALS });

export function Words() {
  return <TextSection label="Words" resource={words}>{(stats) => <>
    <ul class={styles.list}>
      <For each={[
        { name: 'Total words', value: formatCount(stats().totalWords) },
        { name: 'Unique words', value: formatCount(stats().uniqueWords) },
        { name: 'Words per message', value: AVERAGE.format(stats().wordsPerMessage) },
      ]}>{(row) => <li class={`${styles.row} ${look.text}`} {...SHARE_ROW}><span class={styles.rowName}>{row.name}</span><span class={styles.rowCount}>{row.value}</span></li>}</For>
    </ul>
    <p class={look.text} data-size="xs" data-tone="muted">Totals include all words. Top words omit English stop words and words shorter than {MIN_WORD_LENGTH} characters.</p>
    <Subheading>Word cloud</Subheading>
    <WordCloud words={stats().words} />
    <Subheading>Top words</Subheading>
    <ol class={styles.list}>
      <For each={stats().words.slice(0, RANKED_WORDS)}>{(word, index) => <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(word.count, stats().words[0]?.count ?? 0)}>
        <span class={styles.rowLead}><span class={styles.rowCount}>{formatCount(index() + 1)}.</span><span class={styles.rowName}>{word.word}</span></span>
        <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{formatCount(word.count)}</span>
      </li>}</For>
    </ol>
  </>}</TextSection>;
}
