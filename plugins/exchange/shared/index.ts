// Import and export (Settings → Archive): DiscordChatExporter JSON in; DCE-compatible JSON, HTML, plain text, Markdown or CSV out.
import { defineChannels, definePlugin } from '@plugin-sdk/shared';
import type {
  ExchangeResult,
  ExportOptions,
  ExportProgress,
  ExportRequest,
  ExportResult,
  ExportWritten,
  SelectionExportOptions,
  SelectionExportRequest,
  SelectionExportResult,
} from './types';

export const manifest = {
  id: 'exchange',
  name: 'Import and export',
  version: '1.2.0',
  description: 'Imports DiscordChatExporter JSON exports; exports channels (Settings → Archive) or the messages selected in the Archive as an HTML page, JSON, plain text, Markdown or CSV.',
};

/** Core's calls, from main once a file or folder is picked. */
export interface ExchangeCoreCalls {
  /** Archives each file's channel (opted in) and stores its messages. */
  importDce(paths: string[]): ExchangeResult;
  /** One export at a time: a second while one runs is refused. */
  exportChannels(req: ExportRequest): Promise<ExportWritten>;
  /** Stops the running export after the page it is writing. */
  cancelExport(): void;
  /** Writes the selected messages to one file, oldest first. */
  exportMessages(req: SelectionExportRequest): Promise<SelectionExportResult>;
}

/** Main's calls, from Settings: each asks for files or a folder first; null when cancelled. */
export interface ExchangeMainCalls {
  importDce(): Promise<ExchangeResult | null>;
  exportChannels(opts: ExportOptions): Promise<ExportResult | null>;
  /** Stops the running export: the wait for history at once (sync goes on fetching), the writing after its page. */
  cancelExport(): Promise<void>;
  exportMessages(opts: SelectionExportOptions): Promise<SelectionExportResult | null>;
}

export const EXPORT_PROGRESS = 'exportProgress' as const;
export interface ExchangeEvents {
  [EXPORT_PROGRESS]: ExportProgress;
}

/** Its section in Settings → Archive. */
export const EXCHANGE_SECTION = 'exchange' as const;
/** Its action on the Archive's selected messages. */
export const SELECTION_EXPORT = 'export' as const;

export const plugin = definePlugin({
  manifest,
  channels: defineChannels<{ core: ExchangeCoreCalls; main: ExchangeMainCalls; events: ExchangeEvents }>()({
    core: { importDce: ['main'], exportChannels: ['main'], cancelExport: ['main'], exportMessages: ['main'] },
    main: { importDce: ['renderer'], exportChannels: ['renderer'], cancelExport: ['renderer'], exportMessages: ['renderer'] },
    events: { [EXPORT_PROGRESS]: ['renderer'] },
  }),
  settings: [{ id: EXCHANGE_SECTION, label: 'Export and import', page: 'archive' }],
  slots: { selectionMenu: [{ id: SELECTION_EXPORT, after: 'copy' }] },
});
export default plugin;
