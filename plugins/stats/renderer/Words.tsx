import { For } from 'solid-js';
import { look, shownChannelId } from '@plugin-sdk/renderer/kit';
import { MIN_WORD_LENGTH, RANKED_WORDS } from '../shared/text';
import { statsScope, words } from './state';
import { TextSection } from './TextSection';
import { WordCloud } from './WordCloud';
import { SHARE_ROW, Subheading, formatCount, share } from './section';
import styles from './Stats.module.css';
import { MessageLength, formatAverage } from './MessageLength';

export function Words() {
  return <TextSection label="Words" resource={words}>{(stats) => <>
    <ul class={styles.list}>
      <For each={[
        { name: 'Total words', value: formatCount(stats().totalWords) },
        { name: 'Unique words', value: formatCount(stats().uniqueWords) },
        { name: 'Average words per message', value: formatAverage(stats().wordsPerMessage) },
        { name: 'Median words per message', value: formatAverage(stats().length.medianWords) },
      ]}>{(row) => <li class={`${styles.row} ${look.text}`} {...SHARE_ROW}><span class={styles.rowName}>{row.name}</span><span class={styles.rowCount}>{row.value}</span></li>}</For>
    </ul>
    <p class={look.text} data-size="xs" data-tone="muted">Totals include all words. Top words omit English stop words and words shorter than {MIN_WORD_LENGTH} characters.</p>
    <MessageLength stats={stats().length} channelId={statsScope() === 'all' ? null : shownChannelId()} />
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
