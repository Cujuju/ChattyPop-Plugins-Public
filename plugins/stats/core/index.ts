// The Activity plugin's core side: counts for the panel.
import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { activityStats } from './stats';

export default defineCorePlugin(plugin, (ctx) => {
  ctx.channels.serve({ activityStats: (q) => activityStats(ctx.storage.db, q) });
});
