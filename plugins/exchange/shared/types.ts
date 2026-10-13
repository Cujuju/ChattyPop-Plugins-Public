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
}

export interface ExportRequest extends ExportOptions {
  /** Folder the files are written to. */
  dir: string;
}

/** Channels imported, new messages written, and files not imported (invalid, or failed whole). */
export interface ExchangeResult {
  channelIds: string[];
  messages: number;
  skippedFiles: string[];
}

export interface ExportResult {
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

/** An export under way: channels finished of those it covers, and messages written so far. */
export interface ExportProgress {
  channelsDone: number;
  channelsTotal: number;
  messages: number;
}
