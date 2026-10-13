// The Analytics plugin's core side: counts for the panel.
import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { activityStats, postersPage } from './stats';
import { emojiStats } from './emoji';
import { wordStats } from './words';
import { sentimentStats } from './sentiment';
import { conversationStats } from './conversations';
import { personStreaks } from './streaks';

export default defineCorePlugin(plugin, (ctx) => {
  ctx.channels.serve({
    activityStats: (q) => activityStats(ctx.storage.db, q),
    postersPage: (q) => postersPage(ctx.storage.db, q),
    personStreaks: (q) => personStreaks(ctx.storage.db, q),
    emojiStats: async (q) => emojiStats(ctx.storage.db, q),
    wordStats: async (q) => wordStats(ctx.storage.db, q),
    sentimentStats: async (q) => sentimentStats(ctx.storage.db, q),
    conversationStats: async (q) => conversationStats(ctx.storage.db, q),
  });
});
