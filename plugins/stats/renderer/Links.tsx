import { For, Show } from 'solid-js';
import { BrandIcon, look, shownChannelId } from '@plugin-sdk/renderer/kit';
import { ChannelRows } from './ChannelRows';
import { PosterRow } from './PosterRow';
import { CountRows, Subheading, type StatsSectionProps } from './section';
import styles from './Stats.module.css';

export function Links(props: StatsSectionProps) {
  const personChannel = () => props.stats().query.scope === 'all' ? null : shownChannelId();
  return (
    <section class={styles.section} aria-label="Links">
      <Show when={props.stats().linkedMessages} fallback={<p class={look.text} data-size="sm" data-tone="muted">No link shares in this range.</p>}>
        <Subheading>Top link domains</Subheading>
        <CountRows rows={props.stats().domains.map((d) => ({ name: d.domain, count: d.count }))} lead={(domain) => <BrandIcon domain={domain} />} />
        <Subheading>Links by person</Subheading>
        <ol class={styles.list}>
          <For each={props.stats().linksByPerson}>{(poster, index) => <PosterRow poster={poster} rank={index() + 1} channelId={personChannel()} max={props.stats().linksByPerson[0]?.count ?? 0} />}</For>
        </ol>
        <Subheading>Links by channel</Subheading>
        <ChannelRows channels={props.stats().linksByChannel} scope={props.stats().query.scope} />
      </Show>
    </section>
  );
}
