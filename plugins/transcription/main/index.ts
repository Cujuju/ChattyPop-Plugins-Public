// Main downloads missing transcription media through the Discord session or media proxy.
import { defineMainPlugin } from '@plugin-sdk/main';
import { FETCH_AUDIO, plugin } from '../shared';

export default defineMainPlugin(plugin, (ctx) => {
  ctx.channels.on(FETCH_AUDIO, async (r) => {
    const error = r.kind === 'attachment' ? await ctx.attachments.fetchTo(r) : await ctx.media.fetchVideoTo(r.url, r.path);
    await ctx.channels.core.audioFetched(r.requestId, error);
  });
});
