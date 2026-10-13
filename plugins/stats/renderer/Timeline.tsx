import { For, Show } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { CHART_LABEL, Subheading, countLabel, formatCount, share, type StatsSectionProps } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';
import { StreakRows } from './StreakRows';

const CHARTS = [['activePosters', 'Active people per month'], ['newPosters', 'New people per month']] as const;

export function Timeline(props: StatsSectionProps) {
  const max = (key: typeof CHARTS[number][0]) => Math.max(0, ...props.stats().timeline.map((m) => m[key]));
  return (
    <section class={styles.section} aria-label="Timeline">
      <StreakRows stats={props.stats().streaks} />
      <For each={CHARTS}>{([key, label]) => (
        <>
          <Subheading>{label}</Subheading>
          <div class={`${styles.bars} ${look.ruleBelow}`} role="img" aria-label={`${label}, ${formatCount(props.stats().timeline.length)} months`}>
            <For each={props.stats().timeline}>{(month) => (
              <span class={`${styles.bar} ${look.chartBar}`} style={share(month[key], max(key))}
                title={`${formatPeriod(month.start, 'month')}: ${countLabel(month[key], 'person', 'people')}`} />
            )}</For>
          </div>
          <div class={`${styles.axis} ${look.text}`} {...CHART_LABEL}>
            <span>{props.stats().timeline[0] && formatPeriod(props.stats().timeline[0]!.start, 'month')}</span>
            <span>{props.stats().timeline.at(-1) && formatPeriod(props.stats().timeline.at(-1)!.start, 'month')}</span>
          </div>
          <Show when={key === 'newPosters'}>
            <p class={look.text} data-size="xs" data-tone="muted">Counts each person's first archived message here, so the archive's first month counts everyone it sees.</p>
          </Show>
        </>
      )}</For>
    </section>
  );
}
