import { For, Show } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { Subheading, countLabel, formatCount, type StatsSectionProps } from './section';
import { formatPeriod, formatTimestamp } from './periods';
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
            <span class={styles.rowCount}>{formatCount(props.stats()[key])}</span>
          </li>
        )}</For>
      </ul>
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
