// The exchange plugin's core side: reads DCE exports into the archive and writes channels out.
import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { exportChannels, importDceFiles } from './exchange';

export default defineCorePlugin(plugin, (ctx) => {
  ctx.channels.serve({
    importDce: (paths) => {
      const r = importDceFiles(ctx.archive.store(), paths);
      if (r.channelIds.length) ctx.archive.optInChanged();
      r.channelIds.forEach(ctx.archive.changed);
      return r;
    },
    exportChannels: (req) => exportChannels(ctx.storage.db, ctx.archive.attachmentsDir, req),
  });
});
