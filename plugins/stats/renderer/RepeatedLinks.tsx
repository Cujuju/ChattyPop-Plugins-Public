import { For, Show } from 'solid-js';
import { BrandIcon, look } from '@plugin-sdk/renderer/kit';
import { repeats } from './state';
import { PosterRow } from './PosterRow';
import { SHARE_ROW, Subheading, countLabel, share } from './section';
import styles from './Stats.module.css';
import { PeopleRanking } from './PeopleRanking';

export function RepeatedLinks(props: { channelId: string | null }) {
  return <>
    <Subheading>Shared more than once</Subheading>
    <Show when={repeats.failure}><p class="cp-error" role="alert">Couldn't load repeated links. {repeats.failure}</p></Show>
    <Show when={repeats.loading && !repeats()}><p class={look.text} data-size="sm" data-tone="muted" role="status">Loading repeated links…</p></Show>
    <Show when={repeats()}>{(stats) => <>
      <ul class={styles.list} aria-busy={repeats.loading}>
        <For each={stats().urls}>{(url) => <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(url.shares, stats().urls[0]?.shares ?? 0)}>
          <span class={styles.rowLead}>
            <BrandIcon domain={url.host} />
            <a class={`${styles.rowName} ${look.link}`} href={url.url} target="_blank" rel="noreferrer" title={url.url}>
              {url.url.replace(/^https?:\/\//, '')}
            </a>
          </span>
          <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">
            {countLabel(url.shares, 'share')} · {countLabel(url.people, 'person', 'people')}
          </span>
        </li>}</For>
      </ul>
      <Show when={!stats().urls.length}><p class={look.text} data-size="sm" data-tone="muted">No repeated links in this range.</p></Show>
      <PeopleRanking>
        <Subheading>Most reposts</Subheading>
        <ol class={styles.list} aria-busy={repeats.loading}>
          <For each={stats().reposts}>{(person, index) => <PosterRow
            poster={person}
            channelId={props.channelId} rank={index() + 1} max={stats().reposts[0]?.count ?? 0} value={countLabel(person.count, 'repost')} />}</For>
        </ol>
      </PeopleRanking>
    </>}</Show>
  </>;
}
