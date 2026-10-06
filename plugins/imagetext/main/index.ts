// Main downloads missing images through the Discord session, Discord media proxy, or X photo URLs.
import { defineMainPlugin } from '@plugin-sdk/main';
import { FETCH_IMAGE, plugin } from '../shared';

export default defineMainPlugin(plugin, (ctx) => {
  ctx.channels.on(FETCH_IMAGE, async (r) => {
    const error = r.kind === 'attachment' ? await ctx.attachments.fetchTo(r) : await ctx.media.fetchImageTo(r.url, r.path);
    await ctx.channels.core.imageFetched(r.requestId, error);
  });
});
