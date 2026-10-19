import { For, Show } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import { namesChannelId } from './state';
import { ChannelRows } from './ChannelRows';
import { PosterRow } from './PosterRow';
import { DomainRows } from './DomainRows';
import { Subheading, type StatsSectionProps } from './section';
import styles from './Stats.module.css';
import { RepeatedLinks } from './RepeatedLinks';
import { PeopleRanking } from './PeopleRanking';

export function Links(props: StatsSectionProps) {
  return (
    <section class={styles.section} aria-label="Links">
      <Show when={props.stats().linkedMessages} fallback={<p class={look.text} data-size="sm" data-tone="muted">No link shares in this range.</p>}>
        <Subheading>Top link sites</Subheading>
        <DomainRows sites={props.stats().domains} />
        <PeopleRanking>
          <Subheading>Links by person</Subheading>
          <ol class={styles.list}>
            <For each={props.stats().linksByPerson}>{(poster, index) => <PosterRow poster={poster} rank={index() + 1} channelId={namesChannelId()} max={props.stats().linksByPerson[0]?.count ?? 0} />}</For>
          </ol>
        </PeopleRanking>
        <Subheading>Links by channel</Subheading>
        <ChannelRows channels={props.stats().linksByChannel} scope={props.stats().query.scope} />
      </Show>
      <RepeatedLinks channelId={namesChannelId()} />
    </section>
  );
}
