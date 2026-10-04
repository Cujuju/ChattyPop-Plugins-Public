// Summary text with each person it names drawn as a mention: their name now, opening their profile.
import { For } from 'solid-js';
import { look, openPerson } from '@plugin-sdk/renderer/kit';
import { textRuns } from '../shared/people';
import styles from './Summary.module.css';

interface Named {
  /** User id to their name now (Summary.people). */
  people: Readonly<Record<string, string>>;
  /** A channel the summary covers: the profile shows them as members of its server. */
  channelId: string | undefined;
}

/** A person as a mention button. */
export function PersonName(props: Named & { userId: string }) {
  return (
    <button
      type="button"
      class={`${styles.person} ${look.mention}`}
      title="Open their profile"
      onClick={() => openPerson(props.userId, props.channelId ?? null)}
    >
      {props.people[props.userId] ?? props.userId}
    </button>
  );
}

/** `text` with its <@id> people as mentions. */
export function PeopleText(props: Named & { text: string }) {
  return (
    <For each={textRuns(props.text)}>
      {(run) => (typeof run === 'string' ? run : <PersonName userId={run.userId} people={props.people} channelId={props.channelId} />)}
    </For>
  );
}
