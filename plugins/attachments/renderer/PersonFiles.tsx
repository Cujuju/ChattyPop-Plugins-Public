import { For, Show, createEffect, on } from 'solid-js';
import { createPersonFiles } from './personFileState';
import type { AttachmentItem } from '../shared/types';
import { AttachmentGrid } from './AttachmentGrid';
import { PostingsHost } from './PostingsPopover';
import { compressionJob, createSelection } from './selection';
import { SelectionBar } from './SelectionBar';
import { folderSaveJob } from './folderSave';
import styles from './Attachments.module.css';

export function PersonFiles(props: { userId: string }) {
  const selection = createSelection<AttachmentItem>();
  const files = createPersonFiles(() => props.userId);
  createEffect(on(() => props.userId, () => selection.done(), { defer: true }));
  createEffect(() => selection.retain(files.state.items));
  let grid: HTMLDivElement | undefined;
  return (
    <>
      <Show when={selection.selecting() || compressionJob() || folderSaveJob()}><SelectionBar selection={selection} /></Show>
      <Show when={files.state.items.length} fallback={
        <p class={`cp-hint ${styles.personNote}`} title={files.failure() ?? undefined}>
          {files.state.loading ? 'Loading…' : files.failure() ? 'Their files couldn’t be read.' : 'They haven’t shared files in the archive.'}
        </p>
      }>
        <div ref={grid} class={styles.personGrid} on:keydown={(e) => { if (e.key === 'Escape') selection.done(); }}><For each={files.state.items}>{(item) => <AttachmentGrid item={item} selection={selection} />}</For></div>
        <Show when={!files.state.reachedStart}><button type="button" class={`cp-button ${styles.older}`} disabled={files.state.loading}
          onClick={() => void files.older()}>Show older</button></Show>
      </Show>
      <PostingsHost surface={() => grid} />
    </>
  );
}
