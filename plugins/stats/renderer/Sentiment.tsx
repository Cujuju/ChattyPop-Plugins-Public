import { For, createMemo } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { SENTIMENT_CLASSES, sentimentScale, uncancelledShare, type SentimentBucket } from '../shared/text';
import { sentiment } from './state';
import { TextSection } from './TextSection';
import { CHART_LABEL, CountRows, Subheading, countLabel, formatCount, share } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';

const LABELS = { positive: 'Positive', negative: 'Negative', neutral: 'Neutral' };
/** Positive bars rise from the baseline, which the upper strip rules; negative bars hang under it. */
const SIDES = [
  { key: 'positive', opposite: 'negative', tone: 'success', direction: undefined, strip: `${styles.bars} ${look.ruleBelow}` },
  { key: 'negative', opposite: 'positive', tone: 'danger', direction: 'down', strip: `${styles.bars} ${styles.hanging}` },
] as const;

function bucketTitle(bucket: SentimentBucket): string {
  const net = bucket.positive - bucket.negative;
  const balance = net ? `, ${formatCount(Math.abs(net))} more ${net > 0 ? 'positive' : 'negative'}` : '';
  return `${formatPeriod(bucket.start, 'day')}: ${formatCount(bucket.positive)} positive, ${formatCount(bucket.negative)} negative${balance}, of ${countLabel(bucket.messages, 'message with text', 'messages with text')}`;
}

export function Sentiment() {
  return <TextSection label="Sentiment" resource={sentiment}>{(stats) => {
    const scale = createMemo(() => sentimentScale(stats().buckets));
    return <>
      <p class={look.text} data-size="xs" data-tone="muted">This word-list estimate is English only and misreads sarcasm and slang.</p>
      <CountRows rows={SENTIMENT_CLASSES.map((key) => ({ name: LABELS[key], count: stats().classes[key] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))} />
      <Subheading>Positive and negative messages per {stats().bucket}</Subheading>
      <p class={look.text} data-size="xs" data-tone="muted">Positive messages rise above the line and negative ones hang below it, on one scale. The solid part of the longer bar is the balance: how many more messages leaned that way.</p>
      <div role="img" aria-label={`Positive and negative messages per ${stats().bucket}`}>
        <For each={SIDES}>{(side) => <div class={side.strip}>
          <For each={stats().buckets}>{(bucket) => <span class={`${styles.bar} ${look.chartBar}`} data-tone={side.tone} data-direction={side.direction} data-fill="part"
            style={{ ...share(bucket[side.key], scale()), '--fill': String(uncancelledShare(bucket[side.key], bucket[side.opposite])) }} title={bucketTitle(bucket)} />}</For>
        </div>}</For>
      </div>
      <div class={`${styles.axis} ${look.text}`} {...CHART_LABEL}>
        <span>{stats().buckets[0] && formatPeriod(stats().buckets[0]!.start, 'day')}</span>
        <span>{stats().buckets.at(-1) && formatPeriod(stats().buckets.at(-1)!.start, 'day')}</span>
      </div>
    </>;
  }}</TextSection>;
}
