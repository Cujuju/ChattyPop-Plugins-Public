// Summary text with each person it names drawn as Discord draws their name in that place, kept current, opening their profile.
import { For } from 'solid-js';
import { PersonName, look } from '@plugin-sdk/renderer/kit';
import { textRuns } from '../shared/people';
import styles from './Summary.module.css';

interface Named {
  /** User id to their name when the summary was read (Summary.people): shown until the live name arrives. */
  people: Readonly<Record<string, string>>;
  /** The channel the text is about: their name, colours and profile as in its server. */
  channelId: string | undefined;
}

/** `text` with its <@id> people as names. */
export function PeopleText(props: Named & { text: string }) {
  return (
    <For each={textRuns(props.text)}>
      {(run) =>
        typeof run === 'string' ? (
          run
        ) : (
          <PersonName
            userId={run.userId}
            channelId={props.channelId ?? null}
            fallback={props.people[run.userId]}
            class={`${styles.person} ${look.mention}`}
            title="Open their profile"
          />
        )
      }
    </For>
  );
}
