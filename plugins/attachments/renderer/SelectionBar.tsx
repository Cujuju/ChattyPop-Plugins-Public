import { Show, createMemo } from 'solid-js';
import { HeaderButton, Icon, canSaveAttachmentsToFolder, failureNotice, formatBytes, look, showAttachmentFolder } from '@plugin-sdk/renderer/kit';
import { canCompress, compressFiles, deleteFiles, deleteLabel, diskBytes } from './actions';
import { compression, compressionJob, selection, type AttachmentSelection } from './selection';
import { dismissFolderSave, folderSaveJob, saveSelectedToFolder } from './folderSave';
import styles from './Attachments.module.css';

export function SelectionBar(props: { selection?: AttachmentSelection }) {
  const scope = () => props.selection ?? selection;
  // Memos: the count, size, compressible and stored figures each read the selection.
  const selectedItems = createMemo(() => scope().selected());
  const compressible = createMemo(() => selectedItems().filter(canCompress));
  const stored = createMemo(() => selectedItems().filter((i) => i.status === 'stored').length);
  return (
    <div class={`${styles.selectionBar} ${look.band}`}>
      <Show when={folderSaveJob()}>{(job) => <div class={styles.saveStatus}>
        <span class={`${styles.selectionText} ${look.text}`} data-size="xs" role="status" aria-live="polite">
          <Show when={job().running} fallback={job().error ? `Couldn’t save files: ${job().error}` : `Saved ${job().result?.saved ?? 0} files to ${job().result?.folder ?? ''}${job().result?.failed ? ` · ${job().result!.failed} failed` : ''}`}>
            Saving {Math.min(job().done + 1, job().total)} of {job().total}…
          </Show>
        </span>
        <Show when={job().running} fallback={<div class={styles.selectionActions}>
          <Show when={job().result}><HeaderButton onClick={() => void showAttachmentFolder(job().result!.folder).catch(failureNotice("Couldn't show the folder"))}>Show in folder</HeaderButton></Show>
          <HeaderButton onClick={dismissFolderSave}>Dismiss</HeaderButton>
        </div>}>
          <meter class={`${styles.saveMeter} ${look.meter}`} min={0} max={job().total} value={job().done} aria-label="Files saved" />
        </Show>
      </div>}</Show>
      <Show when={!folderSaveJob()?.running}>
        <Show when={compressionJob()?.running} fallback={
          <>
            <span class={`${styles.selectionText} ${look.text}`} data-size="xs" aria-live="polite">
              <Show when={compressionJob()} fallback={<>{selectedItems().length} selected · {formatBytes(diskBytes(selectedItems()))} on disk</>}>
                {(job) => <>Saved {formatBytes(job().savedBytes)} · {job().compressed} compressed · {job().skipped} left alone{job().cancelled ? ' · Cancelled' : ''}</>}
              </Show>
            </span>
            <div class={styles.selectionActions}>
              <Show when={compressionJob()}><HeaderButton onClick={compression.dismiss}>Dismiss</HeaderButton></Show>
              <HeaderButton onClick={() => scope().selectAll()}>Select all loaded</HeaderButton>
              <Show when={canSaveAttachmentsToFolder}><HeaderButton disabled={!stored()} onClick={() => void saveSelectedToFolder(selectedItems())}><Icon name="download" />Save to folder…</HeaderButton></Show>
              <Show when={compressible().length > 0}>
                <HeaderButton title={`Compress ${compressible().length} files`} onClick={() => void compressFiles(selectedItems())}>Compress</HeaderButton>
              </Show>
              <HeaderButton disabled={!stored()} onClick={() => void deleteFiles(selectedItems(), scope())}>{deleteLabel(stored())}</HeaderButton>
              <Show when={selectedItems().length > 0}><HeaderButton onClick={() => scope().clear()}>Clear</HeaderButton></Show>
              <HeaderButton onClick={() => scope().done()}>Done</HeaderButton>
            </div>
          </>
        }>
          <span class={`${styles.selectionText} ${look.text}`} data-size="xs" aria-live="polite">
            Compressing {Math.min((compressionJob()?.done ?? 0) + 1, compressionJob()?.total ?? 0)} of {compressionJob()?.total} · saved {formatBytes(compressionJob()?.savedBytes ?? 0)}
          </span>
          <div class={`${styles.selectionProgress} ${look.progressSweep}`} style={{ '--progress': compressionJob()?.fraction ?? 0 }}
            role="progressbar" aria-label="Compression progress" aria-valuemin={0} aria-valuemax={1} aria-valuenow={compressionJob()?.fraction ?? 0} />
          <div class={styles.selectionActions}><HeaderButton onClick={compression.cancel}>Cancel</HeaderButton></div>
        </Show>
      </Show>
    </div>
  );
}
