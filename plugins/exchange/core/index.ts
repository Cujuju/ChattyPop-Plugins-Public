// The exchange plugin's core side: reads DCE exports into the archive and writes channels out.
import { defineCorePlugin } from '@plugin-sdk/core';
import { EXPORT_PROGRESS, plugin } from '../shared';
import { exportChannels, exportMessages, importDceFiles } from './exchange';

/** Least time between progress events: about four a second reads as live without an event per page or thread. */
const PROGRESS_EVERY_MS = 250;

export default defineCorePlugin(plugin, (ctx) => {
  /** Stops the running export; null while none runs. */
  let stopRunning: (() => void) | null = null;
  ctx.channels.serve({
    importDce: (paths) => {
      const r = importDceFiles(ctx.archive.store(), paths);
      if (r.channelIds.length) ctx.archive.optInChanged();
      r.channelIds.forEach(ctx.archive.changed);
      return r;
    },
    exportChannels: async (req) => {
      if (stopRunning) throw new Error('An export is already running.');
      let stopped = false;
      let reportedAt = 0;
      stopRunning = () => {
        stopped = true;
      };
      try {
        return await exportChannels(ctx.storage.read, ctx.archive.attachmentsDir, req, {
          stopped: () => stopped || !ctx.lifetime.live(),
          progress: (p) => {
            const now = Date.now();
            if (now - reportedAt < PROGRESS_EVERY_MS) return;
            reportedAt = now;
            ctx.channels.emit(EXPORT_PROGRESS, p);
          },
        });
      } finally {
        stopRunning = null;
      }
    },
    cancelExport: () => stopRunning?.(),
    exportMessages: (req) => exportMessages(ctx.storage.read, req),
  });
});
