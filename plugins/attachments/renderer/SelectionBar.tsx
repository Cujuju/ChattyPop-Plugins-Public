import { Show, createMemo } from 'solid-js';
import { HeaderButton, formatBytes, look } from '@plugin-sdk/renderer/kit';
import { canCompress, compressFiles, deleteFiles, deleteLabel, diskBytes } from './actions';
import { compression, compressionJob, selection, type AttachmentSelection } from './selection';
import styles from './Attachments.module.css';

export function SelectionBar(props: { selection?: AttachmentSelection }) {
  const scope = () => props.selection ?? selection;
  // Memos: the count, size, compressible and stored figures each read the selection.
  const selectedItems = createMemo(() => scope().selected());
  const compressible = createMemo(() => selectedItems().filter(canCompress));
  const stored = createMemo(() => selectedItems().filter((i) => i.status === 'stored').length);
  return (
    <div class={`${styles.selectionBar} ${look.band}`}>
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
            <Show when={compressible().length > 0}>
              <HeaderButton title={`Compress ${compressible().length} files`} onClick={() => void compressFiles(selectedItems())}>Compress</HeaderButton>
            </Show>
            <HeaderButton disabled={!stored()} onClick={() => void deleteFiles(selectedItems(), scope())}>{deleteLabel(stored())}</HeaderButton>
            <HeaderButton onClick={() => scope().clear()}>Clear</HeaderButton>
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
    </div>
  );
}
