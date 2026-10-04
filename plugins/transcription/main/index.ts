// Transcription's main side: downloads a job's media through the Discord session (law 4): an attachment the store no
// longer holds, or an embed's video through Discord's media proxy.
import { defineMainPlugin } from '@plugin-sdk/main';
import { FETCH_AUDIO, plugin } from '../shared';

export default defineMainPlugin(plugin, (ctx) => {
  ctx.channels.on(FETCH_AUDIO, async (r) => {
    const error = r.kind === 'attachment' ? await ctx.attachments.fetchTo(r) : await ctx.media.fetchVideoTo(r.url, r.path);
    await ctx.channels.core.audioFetched(r.requestId, error);
  });
});
