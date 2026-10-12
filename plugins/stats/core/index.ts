// The Analytics plugin's core side: counts for the panel.
import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { activityStats, postersPage } from './stats';

export default defineCorePlugin(plugin, (ctx) => {
  ctx.channels.serve({
    activityStats: (q) => activityStats(ctx.storage.db, q),
    postersPage: (q) => postersPage(ctx.storage.db, q),
  });
});
