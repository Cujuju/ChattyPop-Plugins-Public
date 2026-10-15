import { DM_GUILD_ID, type ArchiveAttachment } from '@plugin-sdk/shared';
import {
  attachmentUrl, canCompressHere, canSaveAttachment, compressibleAs, compressStored, confirmDialog, failureNotice, formatBytes,
  freeStored, noticeDialog, openArchive, openMenuAt, saveAttachmentFile, setLightbox, type MenuGroup, type MenuItem, type StoredAttachmentRef,
} from '@plugin-sdk/renderer/kit';
import type { AttachmentItem } from '../shared/types';
import { compression, compressionJob, freeSelection, selection, type AttachmentSelection } from './selection';
import { setWhere, setWho, where } from './state';

export const filesCount = (count: number): string => count === 1 ? '1 file' : `${count} files`;
export const deleteLabel = (count: number): string => count === 1 ? 'Delete local copy' : 'Delete local copies';
const COMPRESS_EFFECT = "Video becomes 720p H.264 mp4, images WebP. Originals on this PC are replaced. A file that wouldn't shrink by a third is left alone.";
const KEPT_IN_ARCHIVE = "The messages stay in the archive. The files can't be restored here.";
/** Why a file isn't on this PC, as a tile's tag. */
const STATUS_MARK: Record<AttachmentItem['status'], string | null> = { stored: null, evicted: 'deleted', pending: 'pending', failed: 'failed' };

/** A file's state as short tags: compressed, why it isn't on this PC, removed from its message. */
export const itemMarks = (item: AttachmentItem): string[] =>
  [item.compressed ? 'compressed' : null, STATUS_MARK[item.status], item.removed ? 'removed' : null].filter((mark): mark is string => mark !== null);

/** Where a file was shared, less what the rail's place already says. */
export function placeText(item: AttachmentItem): string | null {
  const w = where();
  if (w?.by === 'channel') return null;
  const channel = `${item.guildId === DM_GUILD_ID ? '@' : '#'}${item.channelName}`;
  return w?.by === 'guild' || !item.guildName ? channel : `${channel} · ${item.guildName}`;
}

type Storable =Pick<AttachmentItem, 'id' | 'sha256' | 'filename' | 'storedExt' | 'contentType' | 'status' | 'animated' | 'compressed' | 'removed'>;
export const storedRef = (item: Storable): StoredAttachmentRef | null => item.sha256 === null ? null : { ...item, sha256: item.sha256 };
const compressibleRef = (item: Storable): StoredAttachmentRef | null => {
  const ref = storedRef(item);
  return canCompressHere && ref !== null && compressibleAs(ref) !== null ? ref : null;
};
export const canCompress = (item: Storable): boolean => compressibleRef(item) !== null;

/** Shared SHA files contribute their disk bytes only once. */
export function diskBytes(items: readonly AttachmentItem[]): number {
  const sizes = new Map<string, number>();
  for (const item of items) if (item.status === 'stored' && item.sha256) sizes.set(item.sha256, Math.max(sizes.get(item.sha256) ?? 0, item.bytes));
  return [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0);
}

/** Saving needs ArchiveAttachment's metadata; an orphan keeps its SQL metadata and has no notes or description. */
export function archiveAttachment(item: AttachmentItem): ArchiveAttachment {
  return item.message?.attachments.find((a) => a.id === item.id) ?? {
    ...item, storedBytes: item.status === 'stored' ? item.bytes : null, description: null, notes: [],
  };
}

export function openAttachment(item: AttachmentItem): void {
  const ref = storedRef(item);
  if (item.kind === 'image' && ref && item.status === 'stored') {
    setLightbox({ src: attachmentUrl(ref), alt: item.filename, caption: item.filename, originalUrl: null });
  } else void openArchive(item.channelId, item.messageId);
}

const confirmDelete = (count: number, bytes: number): Promise<boolean> => confirmDialog({
  title: deleteLabel(count), confirmLabel: 'Delete', danger: true,
  message: `This deletes ${filesCount(count)} (${formatBytes(bytes)}) from this PC. ${KEPT_IN_ARCHIVE}`,
});

export async function deleteFiles(items: readonly AttachmentItem[], scope: AttachmentSelection = selection): Promise<void> {
  const stored = items.filter((i) => i.status === 'stored' && i.sha256 !== null);
  if (!stored.length || compressionJob()?.running) return;
  if (!await confirmDelete(stored.length, diskBytes(stored))) return;
  try { await freeSelection(stored, freeStored); scope.drop(stored.map((i) => i.id)); }
  catch (error) { failureNotice("Couldn't delete the local copies")(error); }
}

/** One queue for the panel, a person's files and the Attachment menu: its progress shows in the panel's bar. */
async function compressRefs(refs: readonly StoredAttachmentRef[]): Promise<boolean> {
  if (!refs.length || compressionJob()?.running) return false;
  if (!await confirmDialog({ title: 'Compress files', confirmLabel: 'Compress', message: `Compress ${filesCount(refs.length)}? ${COMPRESS_EFFECT}` })) return false;
  try { await compression.run(refs, compressStored); return true; }
  catch (error) { failureNotice("Couldn't compress files")(error); return false; }
}

export const compressFiles = async (items: readonly AttachmentItem[]): Promise<void> =>
  void await compressRefs(items.flatMap((item) => compressibleRef(item) ?? []));

/** Modifiers select before opening; after the first pick every plain click toggles. */
export function clickAttachment(event: MouseEvent, item: AttachmentItem, pick = false, scope: AttachmentSelection = selection): void {
  if (pick || event.ctrlKey || event.metaKey || event.shiftKey || scope.ids().size > 0) scope.toggle(item.id, event.shiftKey);
  else openAttachment(item);
}

export function showItemMenu(anchor: Element, item: AttachmentItem, scopeSelection: AttachmentSelection = selection): void {
  const targets = scopeSelection.ids().has(item.id) && scopeSelection.ids().size > 1 ? scopeSelection.selected() : [item];
  const attachment = archiveAttachment(item);
  const open: MenuItem[] = [
    { label: 'Open', icon: 'eye', run: () => openAttachment(item) },
    { label: 'Show in Archive', icon: 'archive', run: () => { void openArchive(item.channelId, item.messageId); } },
  ];
  if (canSaveAttachment(attachment)) open.push({ label: 'Download', icon: 'download', run: () => saveAttachmentFile(attachment) });
  const scope: MenuItem[] = [{ label: 'Only this channel', icon: 'filter', run: () => { setWhere({ by: 'channel', id: item.channelId }); } }];
  if (item.authorId) scope.push({ label: 'Only this person', icon: 'person', run: () => { setWho(item.authorId); } });
  const change: MenuItem[] = [];
  if (!compressionJob()?.running) {
    const stored = targets.filter((i) => i.status === 'stored').length;
    if (targets.some(canCompress)) change.push({ label: 'Compress', icon: 'compress', run: () => compressFiles(targets) });
    if (stored) change.push({ label: deleteLabel(stored), icon: 'trash', danger: true, run: () => deleteFiles(targets, scopeSelection) });
  }
  const groups: MenuGroup[] = [{ items: open }, { items: scope }, { items: change }];
  openMenuAt(anchor, groups);
}

/** The Attachment menu's compress: the panel may be closed, so the outcome is a notice. */
export async function compressArchiveAttachment(a: ArchiveAttachment): Promise<void> {
  const ref = compressibleRef(a);
  if (!ref || !await compressRefs([ref])) return;
  const job = compressionJob();
  compression.dismiss();
  if (!job || job.cancelled) return;
  void noticeDialog(job.compressed
    ? { title: 'Compressed', message: `${a.filename} now takes ${formatBytes(job.savedBytes)} less on this PC.` }
    : { title: 'Left alone', message: `${a.filename} wouldn't shrink by a third, or this PC can't encode it.` });
}

export async function deleteArchiveAttachment(a: ArchiveAttachment): Promise<void> {
  if (a.status !== 'stored' || !a.sha256 || compressionJob()?.running) return;
  if (!await confirmDelete(1, a.storedBytes ?? a.size ?? 0)) return;
  try { await freeStored([a.id]); selection.drop([a.id]); }
  catch (error) { failureNotice("Couldn't delete the local copy")(error); }
}
