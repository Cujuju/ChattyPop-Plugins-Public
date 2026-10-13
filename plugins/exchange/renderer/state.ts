// Import and export from Settings → Archive: main asks for files or a folder, then core does the work.
import { createSignal } from 'solid-js';
import { mainClient, onEvent } from '@plugin-sdk/renderer';
import { EXPORT_PROGRESS, plugin } from '../shared';
import type { ExportOptions, ExportProgress, ExportResult } from '../shared/types';

const main = mainClient(plugin);

/** Asks for DCE JSON files and imports them; null when cancelled. */
export const importDce = main.importDce;

const [progress, setProgress] = createSignal<ExportProgress | null>(null);
onEvent(plugin, EXPORT_PROGRESS, setProgress);
/** The running export's progress; null before its first report and once it ends. */
export const exportProgress = progress;

/** Asks for a folder and exports there; null when no folder was picked. */
export async function exportChannels(opts: ExportOptions): Promise<ExportResult | null> {
  setProgress(null);
  try {
    return await main.exportChannels(opts);
  } finally {
    setProgress(null);
  }
}

/** Stops the running export: its wait for history at once, its writing after the page under way. */
export const cancelExport = main.cancelExport;

/** Asks for a folder and writes the Archive's selected messages there as one file; null when no folder was picked. */
export const exportMessages = main.exportMessages;
