import { createSignal } from 'solid-js';
import { saveAttachmentsToFolder, type FolderSaveResult } from '@plugin-sdk/renderer/kit';
import type { AttachmentItem } from '../shared/types';
import { storedRef } from './actions';

export interface FolderSaveJob { running: boolean; done: number; total: number; result?: FolderSaveResult; error?: string }
export const [folderSaveJob, setFolderSaveJob] = createSignal<FolderSaveJob | null>(null);
const SAVE_STATUS_MS = 12_000;
let dismissTimer: ReturnType<typeof setTimeout> | undefined;
export const dismissFolderSave = (): void => { if (!folderSaveJob()?.running) setFolderSaveJob(null); };

export async function saveSelectedToFolder(items: readonly AttachmentItem[]): Promise<void> {
  if (folderSaveJob()?.running) return;
  const refs = items.filter((i) => i.status === 'stored').flatMap((i) => storedRef(i) ?? []);
  if (!refs.length) return;
  clearTimeout(dismissTimer);
  setFolderSaveJob({ running: true, done: 0, total: refs.length });
  try {
    const result = await saveAttachmentsToFolder(refs, ({ done, total }) => setFolderSaveJob({ running: true, done, total }));
    setFolderSaveJob(result ? { running: false, done: refs.length, total: refs.length, result } : null);
  } catch (error) {
    setFolderSaveJob({ running: false, done: 0, total: refs.length, error: String(error) });
  }
  dismissTimer = setTimeout(dismissFolderSave, SAVE_STATUS_MS);
}
