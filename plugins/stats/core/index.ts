// The Analytics plugin's core side: counts for the panel.
import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { activityStats, postersPage } from './stats';
import { defineStatsRollups } from './rollups';
import { emojiStats } from './emoji';
import { wordStats } from './words';
import { sentimentStats } from './sentiment';
import { conversationStats } from './conversations';
import { personStreaks } from './streaks';
import { repeatedLinks } from './repeatedLinks';
import { voiceStats } from './voice';
import { peopleStats, personHistory } from './personHistory';

export default defineCorePlugin(plugin, (ctx) => {
  const rollups = defineStatsRollups(ctx);
  ctx.ai.tools.provide(archiveTools(ctx.storage.read, rollups));
  ctx.channels.serve({
    rollupStatus: () => {
      const states = Object.values(rollups).map((r) => r.status());
      return { building: states.some((s) => s.building), dirty: states.reduce((n, s) => n + s.dirty, 0),
        total: states.reduce((n, s) => n + s.total, 0), error: states.find((s) => s.error)?.error ?? null };
    },
    rebuildRollups: (channelIds) => { for (const r of Object.values(rollups)) r.rebuild(channelIds ? { channelIds } : undefined); },
    activityStats: (q) => activityStats(ctx.storage.read, q, rollups),
    postersPage: (q) => postersPage(ctx.storage.read, q, rollups),
    personStreaks: (q) => personStreaks(ctx.storage.read, q, rollups),
    personHistory: (q) => personHistory(ctx.storage.read, q, rollups),
    peopleStats: (q) => peopleStats(ctx.storage.read, q, rollups),
    voiceStats: (q) => voiceStats(ctx.storage.read, q, rollups),
    repeatedLinks: (q) => repeatedLinks(ctx.storage.read, q, rollups),
    emojiStats: async (q) => emojiStats(ctx.storage.read, q, undefined, rollups),
    wordStats: async (q) => wordStats(ctx.storage.read, q, undefined, rollups),
    sentimentStats: async (q) => sentimentStats(ctx.storage.read, q, undefined, rollups),
    conversationStats: async (q) => conversationStats(ctx.storage.read, q, rollups),
  });
});
import { archiveTools } from './aiTools';
