// Import and export from Settings → Archive: main asks for files or a folder, then core does the work.
import { mainClient } from '@plugin-sdk/renderer';
import { plugin } from '../shared';

const main = mainClient(plugin);

/** Asks for DCE JSON files and imports them; null when cancelled. */
export const importDce = main.importDce;
/** Asks for a folder and exports there; null when cancelled. */
export const exportChannels = main.exportChannels;
