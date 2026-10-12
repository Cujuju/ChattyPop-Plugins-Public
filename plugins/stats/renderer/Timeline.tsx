import { For } from 'solid-js';
import { countText, look } from '@plugin-sdk/renderer/kit';
import { CHART_LABEL, SectionHeading, Subheading, share, type StatsSectionProps } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';

const CHARTS = [['activePosters', 'Active people per month'], ['newPosters', 'New people per month']] as const;

export function Timeline(props: StatsSectionProps) {
  const max = (key: typeof CHARTS[number][0]) => Math.max(0, ...props.stats().timeline.map((m) => m[key]));
  return (
    <section class={styles.section} aria-label="Timeline">
      <SectionHeading>Timeline</SectionHeading>
      <p class={look.text} data-size="xs" data-tone="muted">New people posted their first message in this scope during that month.</p>
      <For each={CHARTS}>{([key, label]) => (
        <>
          <Subheading>{label}</Subheading>
          <div class={`${styles.bars} ${look.ruleBelow}`} role="img" aria-label={`${label}, ${props.stats().timeline.length} months`}>
            <For each={props.stats().timeline}>{(month) => (
              <span class={`${styles.bar} ${look.chartBar}`} style={share(month[key], max(key))}
                title={`${formatPeriod(month.start, 'month')}: ${countText(month[key], 'person', 'people')}`} />
            )}</For>
          </div>
          <div class={`${styles.axis} ${look.text}`} {...CHART_LABEL}>
            <span>{props.stats().timeline[0] && formatPeriod(props.stats().timeline[0]!.start, 'month')}</span>
            <span>{props.stats().timeline.at(-1) && formatPeriod(props.stats().timeline.at(-1)!.start, 'month')}</span>
          </div>
        </>
      )}</For>
    </section>
  );
}
