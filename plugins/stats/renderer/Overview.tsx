import { For, Show } from 'solid-js';
import { countText, look } from '@plugin-sdk/renderer/kit';
import { SectionHeading, Subheading, type StatsSectionProps } from './section';
import styles from './Stats.module.css';

const TOTALS = [
  ['messages', 'Messages'], ['authors', 'People'], ['activeDays', 'Active days'], ['editedMessages', 'Edited messages'],
  ['textMessages', 'Messages with text'], ['linkedMessages', 'Messages with links'], ['attachmentMessages', 'Messages with attachments'],
] as const;
const PERIODS = ['hour', 'day', 'month', 'year'] as const;

export function Overview(props: StatsSectionProps) {
  return (
    <section class={styles.section} aria-label="Overview">
      <SectionHeading>Overview</SectionHeading>
      <ul class={styles.list}>
        <For each={TOTALS}>{([key, label]) => (
          <li class={`${styles.row} ${look.text}`} data-size="sm" data-tone="primary">
            <span class={styles.rowName}>{label}</span>
            <span class={styles.rowCount}>{props.stats()[key]}</span>
          </li>
        )}</For>
      </ul>
      <Subheading>Most active</Subheading>
      <ul class={styles.list}>
        <For each={PERIODS}>{(period) => (
          <Show when={props.stats().mostActive[period]}>{(busiest) => (
            <li class={`${styles.row} ${look.text}`} data-size="sm" data-tone="primary">
              <span class={styles.rowName}>Busiest {period}: {busiest().start.replace('T', ' ')}</span>
              <span class={styles.rowCount}>{countText(busiest().count, 'message')}</span>
            </li>
          )}</Show>
        )}</For>
      </ul>
    </section>
  );
}
