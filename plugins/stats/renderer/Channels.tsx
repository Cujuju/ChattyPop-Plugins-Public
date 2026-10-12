import { ChannelRows } from './ChannelRows';
import { SectionHeading, type StatsSectionProps } from './section';
import styles from './Stats.module.css';

export function Channels(props: StatsSectionProps) {
  return (
    <section class={styles.section} aria-label="Channels">
      <SectionHeading>Channels</SectionHeading>
      <ChannelRows channels={props.stats().channels} />
    </section>
  );
}
