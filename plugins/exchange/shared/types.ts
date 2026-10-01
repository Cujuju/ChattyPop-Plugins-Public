// Archive export (DCE-compatible JSON, or a standalone HTML page) and DiscordChatExporter JSON import.

/** Settings → Archive → Export: which channels, which time range, which format. */
export interface ExportOptions {
  channelIds: string[];
  sinceTs?: number;
  untilTs?: number;
  format: 'json' | 'html';
  /** Copy stored attachment files next to the export (otherwise they link to Discord). */
  includeMedia: boolean;
}

export interface ExportRequest extends ExportOptions {
  /** Folder the files are written to. */
  dir: string;
}

/** Channels imported or exported, messages written (new ones on import), and files not imported (invalid, or failed whole). */
export interface ExchangeResult {
  channelIds: string[];
  messages: number;
  skippedFiles: string[];
}
