import { For } from 'solid-js';
import { countText, look } from '@plugin-sdk/renderer/kit';
import { EDIT_DELAY_BUCKETS } from '../shared/types';
import { CHART_LABEL, CountRows, SectionHeading, Subheading, share, type StatsSectionProps } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';

/** Monday first; weekday values match JavaScript and SQLite. */
const WEEK_ROWS = [1, 2, 3, 4, 5, 6, 0];
const REFERENCE_SUNDAY = new Date('2026-01-04T00:00:00');
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const weekdayName = (wd: number): string => WEEKDAY.format(new Date(REFERENCE_SUNDAY.getFullYear(), REFERENCE_SUNDAY.getMonth(), REFERENCE_SUNDAY.getDate() + wd));
const HOUR_TICKS = [0, 6, 12, 18];
const HOURS_PER_DAY = 24;
const HOURS = Array.from({ length: HOURS_PER_DAY }, (_, hour) => hour);
const ATTACHMENT_LABELS = { image: 'Images', video: 'Videos', audio: 'Audio', other: 'Other files' } as const;

export function Messages(props: StatsSectionProps) {
  const maxBucket = () => Math.max(0, ...props.stats().buckets.map((b) => b.count));
  const maxCell = () => Math.max(0, ...props.stats().heatmap.flat());
  return (
    <section class={styles.section} aria-label="Messages">
      <SectionHeading>Messages</SectionHeading>
      <Subheading>Messages per {props.stats().bucket}</Subheading>
      <div class={`${styles.bars} ${look.ruleBelow}`} role="img" aria-label={`Messages per ${props.stats().bucket}, ${props.stats().buckets.length} bars`}>
        <For each={props.stats().buckets}>{(b) => <span class={`${styles.bar} ${look.chartBar}`} style={share(b.count, maxBucket())} title={`${formatPeriod(b.start, 'day')}: ${countText(b.count, 'message')}`} />}</For>
      </div>
      <div class={`${styles.axis} ${look.text}`} {...CHART_LABEL}>
        <span>{props.stats().buckets[0] && formatPeriod(props.stats().buckets[0]!.start, 'day')}</span>
        <span>{props.stats().buckets.at(-1) && formatPeriod(props.stats().buckets.at(-1)!.start, 'day')}</span>
      </div>
      <Subheading>By weekday and hour</Subheading>
      <div class={styles.heatmap} role="img" aria-label="Messages by weekday and hour">
        <For each={WEEK_ROWS}>{(wd) => (
          <>
            <span class={`${styles.dayLabel} ${look.text}`} {...CHART_LABEL}>{weekdayName(wd)}</span>
            <For each={HOURS}>{(hour) => <span class={`${styles.cell} ${look.heatCell}`} style={share(props.stats().heatmap[wd]![hour]!, maxCell())} title={`${weekdayName(wd)} ${hour}:00 · ${countText(props.stats().heatmap[wd]![hour]!, 'message')}`} />}</For>
          </>
        )}</For>
        <span />
        <For each={HOURS}>{(hour) => <span class={look.text} {...CHART_LABEL}>{HOUR_TICKS.includes(hour) ? hour : ''}</span>}</For>
      </div>
      <Subheading>Edit delay</Subheading>
      <CountRows rows={props.stats().editDelay.map((b) => ({ name: EDIT_DELAY_BUCKETS.find((label) => label.id === b.id)!.label, count: b.count }))} />
      <Subheading>Attachment types</Subheading>
      <CountRows rows={props.stats().attachmentTypes.map((a) => ({ name: ATTACHMENT_LABELS[a.kind], count: a.count }))} />
    </section>
  );
}
