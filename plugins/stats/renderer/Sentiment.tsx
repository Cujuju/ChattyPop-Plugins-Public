import { For } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { SENTIMENT_CLASSES } from '../shared/text';
import { sentiment } from './state';
import { TextSection } from './TextSection';
import { CHART_LABEL, CountRows, Subheading, countLabel, share } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';

const LABELS = { positive: 'Positive', negative: 'Negative', neutral: 'Neutral' };
const STRIPS = ['positive', 'negative'] as const;
const PERCENT = new Intl.NumberFormat(undefined, { style: 'percent' });

export function Sentiment() {
  return <TextSection label="Sentiment" resource={sentiment}>{(stats) => <>
    <p class={look.text} data-size="xs" data-tone="muted">This word-list estimate is English only and misreads sarcasm and slang.</p>
    <CountRows rows={SENTIMENT_CLASSES.map((key) => ({ name: LABELS[key], count: stats().classes[key] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))} />
    <For each={STRIPS}>{(key) => <>
      <Subheading>{LABELS[key]} messages per {stats().bucket}</Subheading>
      <div class={`${styles.bars} ${look.ruleBelow}`} role="img" aria-label={`Share of ${key} messages per ${stats().bucket}`}>
        <For each={stats().buckets}>{(bucket) => <span class={`${styles.bar} ${look.chartBar}`} style={share(bucket[key], bucket.messages)}
          title={`${formatPeriod(bucket.start, 'day')}: ${PERCENT.format(bucket.messages ? bucket[key] / bucket.messages : 0)} ${key}, ${countLabel(bucket.messages, 'message with text', 'messages with text')}`} />}</For>
      </div>
      <div class={`${styles.axis} ${look.text}`} {...CHART_LABEL}>
        <span>{stats().buckets[0] && formatPeriod(stats().buckets[0]!.start, 'day')}</span>
        <span>{stats().buckets.at(-1) && formatPeriod(stats().buckets.at(-1)!.start, 'day')}</span>
      </div>
    </>}</For>
  </>}</TextSection>;
}
