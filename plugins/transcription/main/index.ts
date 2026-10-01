// Transcription's main side: downloads audio the store no longer holds, through the Discord session (law 4).
import { defineMainPlugin } from '@plugin-sdk/main';
import { FETCH_AUDIO, plugin } from '../shared';

export default defineMainPlugin(plugin, (ctx) => {
  ctx.channels.on(FETCH_AUDIO, async (r) => {
    await ctx.channels.core.audioFetched(r.requestId, await ctx.attachments.fetchTo(r));
  });
});
