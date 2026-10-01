// The exchange plugin's main side: the file and folder dialogs, then core does the work; imports are brought up to date.
import { defineMainPlugin } from '@plugin-sdk/main';
import { plugin } from '../shared';

export default defineMainPlugin(plugin, (ctx) => {
  const { core } = ctx.channels;
  ctx.channels.serve({
    importDce: async () => {
      const paths = await ctx.dialogs.pickFiles('Import DiscordChatExporter JSON', [{ name: 'DCE JSON export', extensions: ['json'] }]);
      if (!paths.length) return null;
      const r = await core.importDce(paths);
      ctx.sync(r.channelIds); // imported channels are archived: bring them up to date
      return r;
    },
    exportChannels: async (opts) => {
      const dir = await ctx.dialogs.pickFolder('Export to folder');
      if (!dir) return null;
      return core.exportChannels({ ...opts, dir });
    },
  });
});
