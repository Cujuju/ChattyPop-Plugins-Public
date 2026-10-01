// Automatic summary notices retain phone delivery when desktop delivery is quiet.
import { defineMainPlugin } from '@plugin-sdk/main';
import { plugin } from '../shared';
import { summaryNotices } from './notices';

export default defineMainPlugin(plugin, (ctx) => {
  const send = async (notices: ReturnType<typeof summaryNotices>): Promise<void> => {
    if (!notices.length) return;
    const desktop = await ctx.channels.core.notifyAuto();
    for (const notice of notices) {
      await ctx.notifications.show({
        ...notice,
        ...(!desktop && { desktop: false as const }),
      });
    }
  };
  ctx.channels.on('added', (summary) => send(summaryNotices({ type: 'summary-added', summary })));
  ctx.channels.on('failed', (event) => send(summaryNotices({ type: 'summary-auto-failed', ...event })));
});
