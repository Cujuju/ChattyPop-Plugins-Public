import { ChannelRows } from './ChannelRows';
import type { StatsSectionProps } from './section';
import styles from './Stats.module.css';

export function Channels(props: StatsSectionProps) {
  return (
    <section class={styles.section} aria-label="Channels">
      <ChannelRows channels={props.stats().channels} scope={props.stats().query.scope} />
    </section>
  );
}
