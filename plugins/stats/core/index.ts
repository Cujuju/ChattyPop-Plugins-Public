// The Analytics plugin's core side: counts for the panel.
import { defineCorePlugin } from '@plugin-sdk/core';
import { analyticsProgress, publishedReads } from './publishedReads';
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
  const publish = publishedReads(rollups);
  ctx.ai.tools.provide(archiveTools(ctx.storage.read, rollups));
  ctx.channels.serve({
    rollupStatus: () => analyticsProgress(rollups),
    rebuildRollups: (channelIds) => { for (const r of Object.values(rollups)) r.rebuild(channelIds ? { channelIds } : undefined); },
    activityStats: (q) => publish('activityStats', q, () => activityStats(ctx.storage.read, q, rollups)),
    postersPage: (q) => publish('postersPage', q, () => postersPage(ctx.storage.read, q, rollups)),
    personStreaks: (q) => publish('personStreaks', q, () => personStreaks(ctx.storage.read, q, rollups)),
    personHistory: (q) => publish('personHistory', q, () => personHistory(ctx.storage.read, q, rollups)),
    peopleStats: (q) => publish('peopleStats', q, () => peopleStats(ctx.storage.read, q, rollups)),
    voiceStats: (q) => publish('voiceStats', q, () => voiceStats(ctx.storage.read, q, rollups)),
    repeatedLinks: (q) => publish('repeatedLinks', q, () => repeatedLinks(ctx.storage.read, q, rollups)),
    emojiStats: (q) => publish('emojiStats', q, () => emojiStats(ctx.storage.read, q, undefined, rollups)),
    wordStats: (q) => publish('wordStats', q, () => wordStats(ctx.storage.read, q, undefined, rollups)),
    sentimentStats: (q) => publish('sentimentStats', q, () => sentimentStats(ctx.storage.read, q, undefined, rollups)),
    conversationStats: (q) => publish('conversationStats', q, () => conversationStats(ctx.storage.read, q, rollups)),
  });
});
import { archiveTools } from './aiTools';
