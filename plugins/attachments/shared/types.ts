import type { ArchiveMessage } from '@plugin-sdk/shared';

export const ATTACHMENT_KINDS = ['image', 'video', 'audio', 'file'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
/** date: message time. size: sortBytes. name: filename, ignoring case. kind: image, video, audio, file by name. Ties go by time, then id. */
export type AttachmentSortKey = 'date' | 'size' | 'name' | 'kind';
export interface AttachmentSort { key: AttachmentSortKey; dir: 'asc' | 'desc' }
export const NEWEST: AttachmentSort = { key: 'date', dir: 'desc' };
export const LARGEST: AttachmentSort = { key: 'size', dir: 'desc' };
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
  repeated?: boolean;
  /** Part of the filename or derived file text, case-insensitive. */
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
  /** Visible postings of this hash, independent of the panel filters; unhashed files have one. */
  postings: number;
  compressed: boolean; animated: boolean; spoiler: boolean; removed: boolean;
  /** Absent snippet: a spoiler's text matched, and stays hidden. */
  textMatch?: { source: 'text' | 'transcript'; snippet?: string };
  /** Its message as the Archive shows it; null when it left the archive. */ message: ArchiveMessage | null;
}
/** `key`: the row's value of the order's key (sortBytes, filename or kind); date orders need none. */
export interface AttachmentCursor { ts: number; id: string; key?: string | number }
export interface AttachmentPageQuery extends AttachmentFilter {
  limit: number; sort?: AttachmentSort; after?: AttachmentCursor; before?: AttachmentCursor;
  /** Date order only: begin at this calendar month's first file in the order, then continue beyond the month. */
  startMonth?: string;
  /** The IANA zone whose calendar `startMonth` is in: the viewer's. The core's own when absent. */
  timeZone?: string;
  /** Inclusive reading start for refreshing a loaded date window. */
  startAt?: AttachmentCursor;
}
export interface AttachmentMonth { month: string; count: number }
export interface AttachmentTotals { byKind: Record<AttachmentKind, { count: number; bytes: number }>; count: number; /** Bytes on disk, each stored file once. */ bytes: number }
/** A person who shared matching files: `bytes` on this PC, each stored file once. */
export interface PersonRow { id: string; name: string; count: number; bytes: number }
/** People within the filter, whatever its own person. */
export interface PeopleQuery extends AttachmentFilter { limit: number }
export interface PersonFilesQuery { userId: string; limit: number; before?: AttachmentCursor; after?: AttachmentCursor }
/** Matching attachments per server and per channel id (a thread's counted in its channel), whatever the place filter. */
/** File counts by place id; a thread's files count in `threads` and again in its channel's. */
export interface AttachmentPlaces { guilds: Record<string, number>; channels: Record<string, number>; threads: Record<string, number> }

export interface AttachmentPosting {
  id: string; messageId: string; channelId: string; channelName: string; guildId: string | null; guildName: string;
  authorId: string | null; authorName: string; ts: number;
}
export type BreakdownBy = 'guild' | 'channel' | 'person' | 'kind';
export const BREAKDOWN_LIMIT = 50;
/** A null key is the unselectable remainder; groups is its number of remaining groups. */
export interface AttachmentBreakdown {
  key: string | null; label: string; bytes: number; count: number; groups?: number;
  /** Global filtered totals deduplicate across groups too. */
  totalBytes: number; totalCount: number;
}

export interface AttachmentsCoreCalls {
  page(q: AttachmentPageQuery): AttachmentItem[];
  totals(f: AttachmentFilter): AttachmentTotals;
  people(q: PeopleQuery): PersonRow[];
  places(f: AttachmentFilter): AttachmentPlaces;
  /** `timeZone`: the viewer's IANA zone, whose calendar the months follow; the core's own when absent. */
  months(f: AttachmentFilter, timeZone?: string): AttachmentMonth[];
  sharedBy(q: PersonFilesQuery): AttachmentItem[];
  postings(sha256: string): AttachmentPosting[];
  breakdown(f: AttachmentFilter, by: BreakdownBy): AttachmentBreakdown[];
}

export const emptyTotals = (): AttachmentTotals => ({
  byKind: { image: { count: 0, bytes: 0 }, video: { count: 0, bytes: 0 }, audio: { count: 0, bytes: 0 }, file: { count: 0, bytes: 0 } },
  count: 0, bytes: 0,
});
