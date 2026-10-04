// A person's links in the Person window: each link's preview card as the Links panel draws it, smaller, newest first.
import { For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { ARCHIVE_REFRESH_DEBOUNCE_MS, onAppEvent, onAppEventDebounced, onEvent, pluginResource } from '@plugin-sdk/renderer';
import { keyedById } from '@plugin-sdk/renderer/kit';
import { UPDATED_EVENT, plugin } from '../shared';
import type { LinkCard } from '../shared/types';
import { LinkCardRow } from './LinkRow';
import styles from './Links.module.css';

/** Links shown at first, and added by each "Show older". */
const PERSON_LINKS_PAGE = 20;

export function PersonLinks(props: { userId: string }) {
  const [limit, setLimit] = createSignal(PERSON_LINKS_PAGE);
  // Another person starts at the first page again.
  createEffect(on(() => props.userId, () => setLimit(PERSON_LINKS_PAGE), { defer: true }));
  // Matched by id, a re-read (more links, a fetched X post's card) keeps the rows already drawn.
  const links = pluginResource(plugin, 'sharedBy', () => [{ userId: props.userId, limit: limit() }], [] as LinkCard[], { storage: keyedById });
  const refresh = (): void => void links.refetch();
  const offs = [
    onEvent(plugin, UPDATED_EVENT, refresh),
    onAppEventDebounced('archive-changed', ARCHIVE_REFRESH_DEBOUNCE_MS, refresh),
    onAppEvent('privacy-changed', refresh),
  ];
  onCleanup(() => offs.forEach((off) => off()));
  /** A full read may have more behind it. */
  const mayHaveOlder = (): boolean => links().length >= limit();
  return (
    <Show
      when={links().length}
      fallback={
        <p class={`cp-hint ${styles.briefNote}`} title={links.failure ?? undefined}>
          {links.loading ? 'Loading…' : links.failure ? 'Their links couldn’t be read.' : 'They haven’t shared links in the archive.'}
        </p>
      }
    >
      <div class={styles.brief}>
        <For each={links()}>{(item) => <LinkCardRow item={item} own />}</For>
        <Show when={mayHaveOlder()}>
          <button type="button" class={`cp-button ${styles.older}`} disabled={links.loading} onClick={() => setLimit((n) => n + PERSON_LINKS_PAGE)}>
            Show older
          </button>
        </Show>
      </div>
    </Show>
  );
}
