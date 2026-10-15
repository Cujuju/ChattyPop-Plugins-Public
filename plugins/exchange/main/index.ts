// The exchange plugin's main side: the file and folder dialogs and the wait for history, then core does the work; imports are brought up to date.
import { defineMainPlugin, type HistoryResult } from '@plugin-sdk/main';
import { plugin } from '../shared';

export default defineMainPlugin(plugin, (ctx) => {
  const { core } = ctx.channels;
  /** An export is running, from its folder dialog to its last file: one at a time, so Stop reaches it. */
  let exporting = false;
  /** Ends the running export's wait for history; null while none waits. */
  let stopWaiting: (() => void) | null = null;
  /** The channels' history back to `sinceMs`; null when the owner stopped waiting (sync goes on fetching what it was asked). */
  const historyTo = (channelIds: string[], sinceMs: number): Promise<HistoryResult[] | null> =>
    new Promise<HistoryResult[] | null>((resolve, reject) => {
      stopWaiting = () => resolve(null);
      ctx.syncBackTo(channelIds, sinceMs).then(resolve, reject);
    }).finally(() => {
      stopWaiting = null;
    });
  ctx.channels.serve({
    importDce: async () => {
      const paths = await ctx.dialogs.pickFiles('Import DiscordChatExporter JSON', [{ name: 'DCE JSON export', extensions: ['json'] }]);
      if (!paths.length) return null;
      const r = await core.importDce(paths);
      ctx.sync(r.channelIds); // imported channels are archived: bring them up to date
      return r;
    },
    exportChannels: async ({ fetchFirst, ...opts }) => {
      if (exporting) throw new Error('An export is already running.');
      exporting = true;
      try {
        const dir = await ctx.dialogs.pickFolder('Export to folder');
        if (!dir) return null;
        const fetched = fetchFirst && opts.sinceTs !== undefined ? await historyTo(opts.channelIds, opts.sinceTs) : [];
        if (!fetched) return { channelIds: [], messages: 0, emptyChannelIds: [], failedChannelIds: [], unfetchedChannelIds: [], cancelled: true };
        // Resolves when the last file is written, however long that takes.
        const written = await core.exportChannels({ ...opts, dir });
        return { ...written, unfetchedChannelIds: fetched.filter((r) => r.outcome !== 'reached').map((r) => r.channelId) };
      } finally {
        exporting = false;
      }
    },
    cancelExport: async () => {
      stopWaiting?.();
      await core.cancelExport();
    },
    exportMessages: async (opts) => {
      const dir = await ctx.dialogs.pickFolder('Export selected messages to folder');
      return dir ? core.exportMessages({ ...opts, dir }) : null;
    },
  });
});
