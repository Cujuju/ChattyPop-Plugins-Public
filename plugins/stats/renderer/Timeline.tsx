import { For } from 'solid-js';
import { countText, look } from '@plugin-sdk/renderer/kit';
import { SectionHeading, SHARE_ROW, share, type StatsSectionProps } from './section';
import styles from './Stats.module.css';

const LOCAL_MONTH_LENGTH = 'YYYY-MM'.length;

export function Timeline(props: StatsSectionProps) {
  const max = () => Math.max(0, ...props.stats().timeline.map((m) => m.activePosters));
  return (
    <section class={styles.section} aria-label="Timeline">
      <SectionHeading>Timeline</SectionHeading>
      <p class={look.text} data-size="xs" data-tone="muted">New people posted their first message in this scope during that month.</p>
      <ul class={styles.list}>
        <For each={props.stats().timeline}>{(month) => (
          <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(month.activePosters, max())}>
            <span class={styles.rowName}>{month.start.slice(0, LOCAL_MONTH_LENGTH)}</span>
            <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">
              {countText(month.activePosters, 'active person', 'active people')} · {month.newPosters} new
            </span>
          </li>
        )}</For>
      </ul>
    </section>
  );
}
