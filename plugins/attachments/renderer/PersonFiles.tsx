import { For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { ARCHIVE_REFRESH_DEBOUNCE_MS, onAppEvent, onAppEventDebounced, pluginResource } from '@plugin-sdk/renderer';
import { keyedById } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import type { AttachmentItem } from '../shared/types';
import { PERSON_FILES_PAGE } from './state';
import { AttachmentGrid } from './AttachmentGrid';
import { compressionJob, createSelection } from './selection';
import { SelectionBar } from './SelectionBar';
import styles from './Attachments.module.css';

export function PersonFiles(props: { userId: string }) {
  const selection = createSelection<AttachmentItem>();
  const [limit, setLimit] = createSignal(PERSON_FILES_PAGE);
  createEffect(on(() => props.userId, () => { setLimit(PERSON_FILES_PAGE); selection.clear(); }, { defer: true }));
  const files = pluginResource(plugin, 'sharedBy', () => [{ userId: props.userId, limit: limit() }], [] as AttachmentItem[], { storage: keyedById });
  createEffect(() => selection.retain(files()));
  const refresh = (): void => void files.refetch();
  const offs = [onAppEventDebounced('archive-changed', ARCHIVE_REFRESH_DEBOUNCE_MS, refresh), onAppEvent('privacy-changed', () => { selection.clear(); files.mutate([]); refresh(); })];
  onCleanup(() => offs.forEach((off) => off()));
  return (
    <>
      <Show when={selection.ids().size > 0 || compressionJob()}><SelectionBar selection={selection} /></Show>
      <Show when={files().length} fallback={
        <p class={`cp-hint ${styles.personNote}`} title={files.failure ?? undefined}>
          {files.loading ? 'Loading…' : files.failure ? 'Their files couldn’t be read.' : 'They haven’t shared files in the archive.'}
        </p>
      }>
        <div class={styles.personGrid} data-selecting={selection.ids().size > 0} on:keydown={(e) => { if (e.key === 'Escape') selection.clear(); }}><For each={files()}>{(item) => <AttachmentGrid item={item} loaded={files()} selection={selection} />}</For></div>
        <Show when={files().length >= limit()}><button type="button" class={`cp-button ${styles.older}`} disabled={files.loading}
          onClick={() => setLimit((n) => n + PERSON_FILES_PAGE)}>Show older</button></Show>
      </Show>
    </>
  );
}
