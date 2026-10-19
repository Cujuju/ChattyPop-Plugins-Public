// The Analytics plugin's core side: counts for the panel.
import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { activityStats, postersPage } from './stats';
import { emojiStats } from './emoji';
import { wordStats } from './words';
import { sentimentStats } from './sentiment';
import { conversationStats } from './conversations';
import { personStreaks } from './streaks';
import { repeatedLinks } from './repeatedLinks';
import { voiceStats } from './voice';
import { peopleStats, personHistory } from './personHistory';

export default defineCorePlugin(plugin, (ctx) => {
  ctx.ai.tools.provide(archiveTools(ctx.storage.read));
  ctx.channels.serve({
    activityStats: (q) => activityStats(ctx.storage.read, q),
    postersPage: (q) => postersPage(ctx.storage.read, q),
    personStreaks: (q) => personStreaks(ctx.storage.read, q),
    personHistory: (q) => personHistory(ctx.storage.read, q),
    peopleStats: (q) => peopleStats(ctx.storage.read, q),
    voiceStats: (q) => voiceStats(ctx.storage.read, q),
    repeatedLinks: (q) => repeatedLinks(ctx.storage.read, q),
    emojiStats: async (q) => emojiStats(ctx.storage.read, q),
    wordStats: async (q) => wordStats(ctx.storage.read, q),
    sentimentStats: async (q) => sentimentStats(ctx.storage.read, q),
    conversationStats: async (q) => conversationStats(ctx.storage.read, q),
  });
});
import { archiveTools } from './aiTools';
