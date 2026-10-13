// Archive export (DCE-compatible JSON, a standalone HTML page, plain text, Markdown or CSV) and DiscordChatExporter JSON import.

export const EXPORT_FORMATS = ['html', 'json', 'txt', 'md', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Settings → Archive → Export: which channels, which time range, which format. */
export interface ExportOptions {
  channelIds: string[];
  /** Also export each chosen channel's threads and forum posts. */
  includeThreads: boolean;
  sinceTs?: number;
  untilTs?: number;
  format: ExportFormat;
  /** Copy stored attachment files next to the export (otherwise they link to Discord). */
  includeMedia: boolean;
  /** Fetch each chosen channel's history back to sinceTs before writing; without a sinceTs nothing is fetched. */
  fetchFirst: boolean;
}

/** What core writes: the fetch is main's, before it. */
export interface ExportRequest extends Omit<ExportOptions, 'fetchFirst'> {
  /** Folder the files are written to. */
  dir: string;
}

/** Channels imported, new messages written, and files not imported (invalid, or failed whole). */
export interface ExchangeResult {
  channelIds: string[];
  messages: number;
  skippedFiles: string[];
}

export interface ExportWritten {
  /** Channels and threads a file was written for. */
  channelIds: string[];
  messages: number;
  /** Chosen channels with no message in the range: no file is written. */
  emptyChannelIds: string[];
  /** Channels whose file could not be written; the others still export. */
  failedChannelIds: string[];
  /** Stopped before every channel was written; finished files stay. */
  cancelled: boolean;
}

export interface ExportResult extends ExportWritten {
  /** Chosen channels whose history didn't reach the range's start (sync paused, or a request failed); what is stored is exported. */
  unfetchedChannelIds: string[];
}

/** Messages selected in the Archive, all of one channel. */
export interface SelectionExportOptions {
  channelId: string;
  messageIds: string[];
  format: ExportFormat;
}

export interface SelectionExportRequest extends SelectionExportOptions {
  /** Folder the file is written to. */
  dir: string;
}

export interface SelectionExportResult {
  /** The file written; null when none of the messages is still stored with its content. */
  file: string | null;
  messages: number;
}

/** An export under way: channels finished of those it covers, and messages written so far. */
export interface ExportProgress {
  channelsDone: number;
  channelsTotal: number;
  messages: number;
}
