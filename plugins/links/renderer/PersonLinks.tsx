// A person's links in the Person window: each link's preview card as the Links panel draws it, smaller, newest first.
import { For, Show } from 'solid-js';
import { createPersonLinks } from './personLinkState';
import { LinkCardRow } from './LinkRow';
import styles from './Links.module.css';

export function PersonLinks(props: { userId: string }) {
  const links = createPersonLinks(() => props.userId);
  return (
    <Show
      when={links.state.items.length}
      fallback={
        <p class={`cp-hint ${styles.briefNote}`} title={links.failure() ?? undefined}>
          {links.state.loading ? 'Loading…' : links.failure() ? 'Their links couldn’t be read.' : 'They haven’t shared links in the archive.'}
        </p>
      }
    >
      <div class={styles.brief}>
        <For each={links.state.items}>{(item) => <LinkCardRow item={item} own />}</For>
        <Show when={!links.state.reachedStart}>
          <button type="button" class={`cp-button ${styles.older}`} disabled={links.state.loading} onClick={() => void links.older()}>
            Show older
          </button>
        </Show>
      </div>
    </Show>
  );
}
