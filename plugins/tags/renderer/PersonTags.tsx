// The owner's top tags in the person view, with the existing markup and wording.
import { For, Show } from 'solid-js';
import { look, querySearch, setSearchOpen } from '@plugin-sdk/renderer/kit';
import { fromUserQuery } from '@plugin-sdk/shared';
import { createPersonTags } from './personState';
import styles from './Tags.module.css';

/** Tags counted only across this person's visible archived messages. */
export function PersonTags(props: { userId: string }) {
  const values = createPersonTags(() => props.userId);
  const search = (query: string): void => {
    querySearch(query);
    setSearchOpen(true);
    document.getElementById('archive-search')?.focus();
  };
  return (
    <>
      <Show when={values()?.length}>
        <h3 class={`${styles.personHeading} ${look.text}`} data-size="2xs" data-weight="medium" data-tracking="label" data-case="upper" data-tone="muted">
          Tags on their messages
        </h3>
        <div class={styles.personTags}>
          <For each={values()}>
            {(t) => (
              <button
                type="button"
                class={`${styles.personTag} ${look.pillButton} ${look.text}`}
                data-size="xs"
                onClick={() => search(`${fromUserQuery(props.userId)} tag:"${t.name}"`)}
              >
                {t.name}{' '}
                <span class={`${styles.personTagCount} ${look.text}`} data-size="xs" data-tone="muted">
                  {t.count}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
