// Image text's main side: downloads images the store doesn't hold, an attachment through the Discord session (law 4),
// an embed's through Discord's media proxy, a fetched post's photo from X.
import { defineMainPlugin } from '@plugin-sdk/main';
import { FETCH_IMAGE, plugin } from '../shared';

export default defineMainPlugin(plugin, (ctx) => {
  ctx.channels.on(FETCH_IMAGE, async (r) => {
    const error = r.kind === 'attachment' ? await ctx.attachments.fetchTo(r) : await ctx.media.fetchImageTo(r.url, r.path);
    await ctx.channels.core.imageFetched(r.requestId, error);
  });
});
