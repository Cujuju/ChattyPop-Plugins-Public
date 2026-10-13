import { For, Show } from 'solid-js';
import { look, personName } from '@plugin-sdk/renderer/kit';
import type { DayRun, StreakStats } from '../shared/streaks';
import { people } from './state';
import { PosterRow } from './PosterRow';
import { SHARE_ROW, Subheading, countLabel } from './section';
import { formatPeriod } from './periods';
import styles from './Stats.module.css';

const RUNS = [['longest', 'Longest active streak'], ['current', 'Current run (ending on the last active day)'], ['gap', 'Longest silence']] as const;
const runLabel = (run: DayRun): string => `${countLabel(run.days, 'day')} · ${formatPeriod(run.start, 'day')} – ${formatPeriod(run.end, 'day')}`;

export function StreakRows(props: { stats: StreakStats }) {
  return <>
    <Subheading>Streaks and silences</Subheading>
    <ul class={styles.list}>
      <For each={RUNS}>{([key, label]) => <li class={`${styles.row} ${look.text}`} {...SHARE_ROW}>
        <span class={styles.rowName}>{label}</span>
        <span class={styles.rowCount}>{props.stats[key] ? runLabel(props.stats[key]!) : 'None'}</span>
      </li>}</For>
    </ul>
    <p class={look.text} data-size="xs" data-tone="muted">Silences count inactive local dates between active days.</p>
  </>;
}

export function PersonStreakRows(props: { channelId: string | null }) {
  const personRuns = () => people()?.history.streaks;
  return <>
    <Subheading>Longest streaks</Subheading>
    <Show when={people.failure}><p class="cp-error" role="alert">Couldn't load streaks. {people.failure}</p></Show>
    <Show when={people.loading && !personRuns()}><p class={look.text} data-size="sm" data-tone="muted" role="status">Loading streaks…</p></Show>
    <ol class={styles.list} aria-busy={people.loading}>
      <For each={personRuns()}>{(person, index) => <PosterRow
        poster={{ userId: person.userId, name: personName(person.userId, props.channelId)?.name ?? person.userId, avatar: null, count: person.days }}
        channelId={props.channelId} rank={index() + 1} max={personRuns()?.[0]?.days ?? 0} value={runLabel(person)} />}</For>
    </ol>
    <Show when={personRuns() && !personRuns()!.length && !people.loading}>
      <p class={look.text} data-size="sm" data-tone="muted">No active days in this range.</p>
    </Show>
  </>;
}
