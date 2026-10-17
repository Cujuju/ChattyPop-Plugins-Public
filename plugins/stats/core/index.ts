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
  ctx.ai.tools.provide(archiveTools(ctx.storage.db));
  ctx.channels.serve({
    activityStats: (q) => activityStats(ctx.storage.db, q),
    postersPage: (q) => postersPage(ctx.storage.db, q),
    personStreaks: (q) => personStreaks(ctx.storage.db, q),
    personHistory: (q) => personHistory(ctx.storage.db, q),
    peopleStats: (q) => peopleStats(ctx.storage.db, q),
    voiceStats: (q) => voiceStats(ctx.storage.db, q),
    repeatedLinks: (q) => repeatedLinks(ctx.storage.db, q),
    emojiStats: async (q) => emojiStats(ctx.storage.db, q),
    wordStats: async (q) => wordStats(ctx.storage.db, q),
    sentimentStats: async (q) => sentimentStats(ctx.storage.db, q),
    conversationStats: async (q) => conversationStats(ctx.storage.db, q),
  });
});
import { archiveTools } from './aiTools';
