import type { ArchiveMessage } from '@plugin-sdk/shared';

export const ATTACHMENT_KINDS = ['image', 'video', 'audio', 'file'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
/** newest: by message time. largest: most sortBytes first, then newest. */
export type AttachmentSort = 'newest' | 'largest';
/** stored: its file is on this PC. gone: evicted, failed or not yet downloaded. */
export type AttachmentPresence = 'stored' | 'gone' | 'any';
export interface AttachmentFilter {
  guildId?: string;
  /** The channel and its threads. */
  channelId?: string;
  authorId?: string;
  kinds?: AttachmentKind[];
  sinceTs?: number;
  untilTs?: number;
  /** At least this many bytes (on disk, else Discord's size). */
  minBytes?: number;
  presence?: AttachmentPresence;
  /** Only stored images and videos not yet compressed. */
  uncompressed?: boolean;
  /** Part of the filename, case-insensitive. */
  name?: string;
}
export interface AttachmentItem {
  id: string; messageId: string; channelId: string; channelName: string; guildId: string | null; guildName: string;
  authorId: string | null; authorName: string; ts: number;
  filename: string; contentType: string | null; kind: AttachmentKind;
  /** Discord's size of the original. */ size: number | null;
  /** Bytes on this PC; 0 when not stored. */ bytes: number;
  /** What largest orders by and a tile shows: bytes on this PC, else Discord's size. */ sortBytes: number;
  width: number | null; height: number | null;
  sha256: string | null; storedExt: string | null; status: 'pending' | 'stored' | 'failed' | 'evicted';
  compressed: boolean; animated: boolean; spoiler: boolean; removed: boolean;
  /** Its message as the Archive shows it; null when it left the archive. */ message: ArchiveMessage | null;
}
/** `bytes`: the row's sortBytes, for the largest order. */
export interface AttachmentCursor { ts: number; id: string; bytes?: number }
export interface AttachmentPageQuery extends AttachmentFilter { limit: number; sort?: AttachmentSort; after?: AttachmentCursor; before?: AttachmentCursor }
export interface AttachmentTotals { byKind: Record<AttachmentKind, { count: number; bytes: number }>; count: number; /** Bytes on disk, each stored file once. */ bytes: number }
export type BreakdownBy = 'guild' | 'channel' | 'author';
export interface BreakdownRow { id: string; name: string; /** A channel's server; else ''. */ detail: string; count: number; bytes: number }
export interface BreakdownQuery extends AttachmentFilter { by: BreakdownBy; limit: number }
export interface PersonFilesQuery { userId: string; limit: number }
/** Matching attachments per server and per channel id (a thread's counted in its channel), whatever the place filter. */
export interface AttachmentPlaces { guilds: Record<string, number>; channels: Record<string, number> }

export interface AttachmentsCoreCalls {
  page(q: AttachmentPageQuery): AttachmentItem[];
  totals(f: AttachmentFilter): AttachmentTotals;
  breakdown(q: BreakdownQuery): BreakdownRow[];
  places(f: AttachmentFilter): AttachmentPlaces;
  sharedBy(q: PersonFilesQuery): AttachmentItem[];
}

export const emptyTotals = (): AttachmentTotals => ({
  byKind: { image: { count: 0, bytes: 0 }, video: { count: 0, bytes: 0 }, audio: { count: 0, bytes: 0 }, file: { count: 0, bytes: 0 } },
  count: 0, bytes: 0,
});
