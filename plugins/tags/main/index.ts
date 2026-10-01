// The owner's tag names in Discord's host label decoration.
import { defineMainPlugin } from '@plugin-sdk/main';
import { plugin } from '../shared';

export default defineMainPlugin(
  plugin,
  (ctx) => {
    ctx.live.labels.provide(async (channelId) => {
      const chips = await ctx.channels.core.liveTagChips(channelId);
      return Object.fromEntries(Object.entries(chips).map(([id, labels]) => [id, labels.map((label) => label.name)]));
    });
    ctx.channels.on('changed', () => ctx.live.labels.changed());
  },
);
