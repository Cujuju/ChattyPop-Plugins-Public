import { For, Show } from 'solid-js';
import { look, shortDate } from '@plugin-sdk/renderer/kit';
import { PERSON_SILENCE_DAYS, QUIET_MIN_MESSAGES } from '../shared/personHistory';
import { people } from './state';
import { PosterRow } from './PosterRow';
import { Subheading, countLabel } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';

export function PersonHistory(props: { channelId: string | null }) {
  const peopleHistory = () => people()?.history;
  return <>
    <p class={look.text} data-size="xs" data-tone="muted">Went quiet and Came back use this scope's whole archive, ignoring the selected range.
      The archive's start{peopleHistory()?.archivedSince !== null && peopleHistory()?.archivedSince !== undefined ? ` (${shortDate(peopleHistory()!.archivedSince!)})` : ''} bounds what can be known.
      {peopleHistory()?.lastDay ? ` Measured against the scope's last message on ${formatPeriod(peopleHistory()!.lastDay!, 'day')}.` : ''}</p>
    <Subheading>Went quiet</Subheading>
    <p class={look.text} data-size="xs" data-tone="muted">At least {QUIET_MIN_MESSAGES} messages; last seen more than {PERSON_SILENCE_DAYS} local days before the scope's last message.</p>
    <Show when={people.failure}><p class="cp-error" role="alert">Couldn't load people history. {people.failure}</p></Show>
    <Show when={people.loading && !peopleHistory()}><p class={look.text} data-size="sm" data-tone="muted" role="status">Loading people history…</p></Show>
    <Show when={peopleHistory()}>{(stats) => <>
      <ol class={styles.list} aria-busy={people.loading}>
        <For each={stats().quiet}>{(person, index) => <PosterRow poster={person} channelId={props.channelId} rank={index() + 1} max={stats().quiet[0]?.count ?? 0}
          value={`${countLabel(person.count, 'message')} · last seen ${formatPeriod(person.lastSeen, 'day')}`} />}</For>
      </ol>
      <Show when={!stats().quiet.length}><p class={look.text} data-size="sm" data-tone="muted">No qualifying quiet posters.</p></Show>
      <Subheading>Came back</Subheading>
      <p class={look.text} data-size="xs" data-tone="muted">Latest consecutive-day run began within {PERSON_SILENCE_DAYS} local days of the scope's last message, after at least {PERSON_SILENCE_DAYS} inactive local dates.</p>
      <ol class={styles.list} aria-busy={people.loading}>
        <For each={stats().returned}>{(person, index) => <PosterRow poster={{ ...person, count: person.silenceDays }} channelId={props.channelId} rank={index() + 1} max={stats().returned[0]?.silenceDays ?? 0}
          value={`${countLabel(person.silenceDays, 'day')} silent · returned ${formatPeriod(person.returned, 'day')}`} title={countLabel(person.count, 'archived message')} />}</For>
      </ol>
      <Show when={!stats().returned.length}><p class={look.text} data-size="sm" data-tone="muted">No qualifying returns.</p></Show>
    </>}</Show>
  </>;
}
