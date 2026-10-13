import { For, Show } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { Subheading, countLabel, formatCount, type StatsSectionProps } from './section';
import { formatPeriod, formatTimestamp } from './periods';
import { comparisonDelta } from './comparison';
import styles from './Stats.module.css';

const TOTALS = [
  ['messages', 'Messages'], ['authors', 'People'], ['activeDays', 'Active days'], ['editedMessages', 'Edited messages'],
  ['textMessages', 'Messages with text'], ['linkedMessages', 'Messages with links'], ['attachmentMessages', 'Messages with attachments'],
] as const;
const PERIODS = ['hour', 'day', 'month', 'year'] as const;

export function Overview(props: StatsSectionProps) {
  return (
    <section class={styles.section} aria-label="Overview">
      <ul class={styles.list}>
        <li class={`${styles.row} ${look.text}`} data-size="sm" data-tone="primary">
          <span class={styles.rowName}>Archived since</span>
          <span class={styles.rowCount}>{props.stats().archivedSince === null ? 'No archived messages' : formatTimestamp(props.stats().archivedSince!)}</span>
        </li>
        <For each={TOTALS}>{([key, label]) => (
          <li class={`${styles.row} ${look.text}`} data-size="sm" data-tone="primary">
            <span class={styles.rowName}>{label}</span>
            <span class={styles.rowCount}>
              {formatCount(props.stats()[key])}
              <Show when={props.stats().comparison?.totals}>{(earlier) => <>
                {' '}<span class={look.text} data-size="xs" data-tone="muted"
                  title={`Current: ${formatCount(props.stats()[key])}; preceding: ${formatCount(earlier()[key])}`}>
                  {comparisonDelta(props.stats()[key], earlier()[key])}
                </span>
              </>}</Show>
            </span>
          </li>
        )}</For>
      </ul>
      <Show when={props.stats().comparison && !props.stats().comparison!.totals}>
        <p class={look.text} data-size="xs" data-tone="muted">The archive does not reach the earlier period.</p>
      </Show>
      <Subheading>Most active</Subheading>
      <ul class={styles.list}>
        <For each={PERIODS}>{(period) => (
          <Show when={props.stats().mostActive[period]}>{(busiest) => (
            <li class={`${styles.row} ${look.text}`} data-size="sm" data-tone="primary">
              <span class={styles.rowName}>Busiest {period}: {formatPeriod(busiest().start, period)}</span>
              <span class={styles.rowCount}>{countLabel(busiest().count, 'message')}</span>
            </li>
          )}</Show>
        )}</For>
      </ul>
    </section>
  );
}
