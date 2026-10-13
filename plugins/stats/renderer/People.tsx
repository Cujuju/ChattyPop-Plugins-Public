import { For, Show } from 'solid-js';
import { look, shownChannelId } from '@plugin-sdk/renderer/kit';
import { POSTERS_TOP } from '../shared/types';
import { createPosterList, people, statsAuthor } from './state';
import { PosterRow } from './PosterRow';
import { Subheading, countLabel, type StatsSectionProps } from './section';
import styles from './Stats.module.css';
import { PersonStreakRows } from './StreakRows';
import { Voice } from './Voice';
import { PersonHistory } from './PersonHistory';
import { PeopleRanking } from './PeopleRanking';

export function People(props: StatsSectionProps) {
  const pages = createPosterList();
  const posters = () => pages.expanded() ? pages.items() : props.stats().posters;
  const personChannel = () => props.stats().query.scope === 'all' ? null : shownChannelId();
  const max = () => posters()[0]?.count ?? 0;
  return (
    <section class={styles.section} aria-label="People">
      <Show when={statsAuthor() !== null}>
        <Subheading>Person in this scope and range</Subheading>
        <Show when={people()?.person} fallback={<p class={look.text} data-size="sm" data-tone="muted">No messages in this range.</p>}>{(person) =>
          <ol class={styles.list}><PosterRow poster={person().poster} rank={person().rank} channelId={personChannel()} max={person().poster.count}
            value={`${countLabel(person().poster.count, 'message')} · rank ${person().rank}`} /></ol>
        }</Show>
      </Show>
      <PeopleRanking>
        <Subheading>{pages.expanded() ? 'All posters' : 'Top posters'}</Subheading>
        <ol class={styles.list} aria-busy={pages.loading()}>
          <For each={posters()}>{(poster, index) => <PosterRow poster={poster} rank={index() + 1} channelId={personChannel()} max={max()} />}</For>
        </ol>
        <Show when={pages.failure()}>
          <p class="cp-error" role="alert">Couldn't load posters. {pages.failure()}</p>
        </Show>
        <Show when={pages.loading()}>
          <p class={look.text} data-size="sm" data-tone="muted" role="status">Loading posters…</p>
        </Show>
        <Show when={pages.expanded()} fallback={
          <button type="button" class={look.button} aria-expanded="false" onClick={() => void pages.showAll(props.stats().query)}>Show all</button>
        }>
          <p class={look.text} data-size="xs" data-tone="muted">{countLabel(pages.items().length, 'person loaded', 'people loaded')}</p>
          <Show when={!pages.reachedEnd()}>
            <button type="button" class={look.button} disabled={pages.loading()} onClick={() => void pages.loadMore(props.stats().query)}>
              {pages.failure() ? 'Retry' : 'Load more'}
            </button>
          </Show>
          <button type="button" class={look.button} aria-expanded="true" onClick={pages.reset}>Show top {POSTERS_TOP}</button>
        </Show>
      </PeopleRanking>
      <PersonStreakRows channelId={personChannel()} />
      <Voice channelId={personChannel()} />
      <PersonHistory channelId={personChannel()} />
    </section>
  );
}
