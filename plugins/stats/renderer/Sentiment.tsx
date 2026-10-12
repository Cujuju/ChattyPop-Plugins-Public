import { For, createMemo } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { SENTIMENT_CLASSES, SENTIMENT_MIN_SAMPLE, sentimentFractions } from '../shared/text';
import { sentiment } from './state';
import { TextSection } from './TextSection';
import { CHART_LABEL, CountRows, Subheading, countLabel, share } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';

const LABELS = { positive: 'Positive', negative: 'Negative', neutral: 'Neutral' };
const STRIPS = ['positive', 'negative'] as const;
const PERCENT = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 });

export function Sentiment() {
  return <TextSection label="Sentiment" resource={sentiment}>{(stats) => <>
    <p class={look.text} data-size="xs" data-tone="muted">This word-list estimate is English only and misreads sarcasm and slang.</p>
    <CountRows rows={SENTIMENT_CLASSES.map((key) => ({ name: LABELS[key], count: stats().classes[key] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))} />
    <For each={STRIPS}>{(key) => {
      const buckets = createMemo(() => {
        const source = stats().buckets;
        const fractions = sentimentFractions(source, key);
        return source.map((bucket, index) => ({ bucket, fraction: fractions[index]! }));
      });
      return <>
      <Subheading>Share of {key} messages per {stats().bucket}</Subheading>
      <p class={look.text} data-size="xs" data-tone="muted">At least {countLabel(SENTIMENT_MIN_SAMPLE, 'message with text', 'messages with text')} per bucket. Bar heights are relative to the highest share.</p>
      <div class={`${styles.bars} ${look.ruleBelow}`} role="img" aria-label={`Share of ${key} messages per ${stats().bucket}`}>
        <For each={buckets()}>{({ bucket, fraction }) => <span class={`${styles.bar} ${look.chartBar}`} style={share(fraction === 'unrated' ? 0 : fraction, 1)}
          title={`${formatPeriod(bucket.start, 'day')}: ${fraction === 'unrated' ? 'too few messages to rate' : `${PERCENT.format(bucket[key] / bucket.messages)} ${key}`}, ${countLabel(bucket.messages, 'message with text', 'messages with text')}`} />}</For>
      </div>
      <div class={`${styles.axis} ${look.text}`} {...CHART_LABEL}>
        <span>{stats().buckets[0] && formatPeriod(stats().buckets[0]!.start, 'day')}</span>
        <span>{stats().buckets.at(-1) && formatPeriod(stats().buckets.at(-1)!.start, 'day')}</span>
      </div>
    </>;
    }}</For>
  </>}</TextSection>;
}
