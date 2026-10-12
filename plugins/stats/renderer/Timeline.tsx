import { For } from 'solid-js';
import { countText, look } from '@plugin-sdk/renderer/kit';
import { SectionHeading, SHARE_ROW, share, type StatsSectionProps } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';

export function Timeline(props: StatsSectionProps) {
  const max = () => Math.max(0, ...props.stats().timeline.map((m) => m.activePosters));
  return (
    <section class={styles.section} aria-label="Timeline">
      <SectionHeading>Timeline</SectionHeading>
      <p class={look.text} data-size="xs" data-tone="muted">New people posted their first message in this scope during that month.</p>
      <ul class={styles.list}>
        <For each={props.stats().timeline}>{(month) => (
          <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(month.activePosters, max())}>
            <span class={styles.rowName}>{formatPeriod(month.start, 'month')}</span>
            <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">
              {countText(month.activePosters, 'active person', 'active people')} · {month.newPosters} new
            </span>
          </li>
        )}</For>
      </ul>
    </section>
  );
}
