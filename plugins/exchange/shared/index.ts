// Import and export (Settings → Archive): DiscordChatExporter JSON in; DCE-compatible JSON, HTML, plain text, Markdown or CSV out.
import { defineChannels, definePlugin } from '@plugin-sdk/shared';
import type { ExchangeResult, ExportOptions, ExportProgress, ExportRequest, ExportResult } from './types';

export const manifest = {
  id: 'exchange',
  name: 'Import and export',
  version: '1.1.0',
  description: 'Imports DiscordChatExporter JSON exports; exports channels as an HTML page, JSON, plain text, Markdown or CSV (Settings → Archive).',
};

/** Core's calls, from main once a file or folder is picked. */
export interface ExchangeCoreCalls {
  /** Archives each file's channel (opted in) and stores its messages. */
  importDce(paths: string[]): ExchangeResult;
  /** One export at a time: a second while one runs is refused. */
  exportChannels(req: ExportRequest): Promise<ExportResult>;
  /** Stops the running export after the page it is writing. */
  cancelExport(): void;
}

/** Main's calls, from Settings: each asks for files or a folder first; null when cancelled. */
export interface ExchangeMainCalls {
  importDce(): Promise<ExchangeResult | null>;
  exportChannels(opts: ExportOptions): Promise<ExportResult | null>;
}

export const EXPORT_PROGRESS = 'exportProgress' as const;
export interface ExchangeEvents {
  [EXPORT_PROGRESS]: ExportProgress;
}

/** Its section in Settings → Archive. */
export const EXCHANGE_SECTION = 'exchange' as const;

export const plugin = definePlugin({
  manifest,
  channels: defineChannels<{ core: ExchangeCoreCalls; main: ExchangeMainCalls; events: ExchangeEvents }>()({
    core: { importDce: ['main'], exportChannels: ['main'], cancelExport: ['renderer'] },
    main: { importDce: ['renderer'], exportChannels: ['renderer'] },
    events: { [EXPORT_PROGRESS]: ['renderer'] },
  }),
  settings: [{ id: EXCHANGE_SECTION, label: 'Export and import', page: 'archive' }],
});
export default plugin;
