// Plans' core side: the per-message plan question, its extraction, and the list the panel shows.
import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { planList, planQuestion } from './plans';
import { PLANS_MIGRATIONS } from './schema';

export default defineCorePlugin(plugin, (ctx) => {
  // Hits still to extract are stored, so turning Plans off and on, or quitting, resumes them.
  ctx.storage.migrate(PLANS_MIGRATIONS);
  ctx.jev.questions.register(
    planQuestion({
      db: ctx.storage.db,
      provider: () => ctx.ai.settings().defaultProvider,
      complete: (req) => ctx.ai.complete(req),
      changed: ctx.archive.changed,
    }),
  );
  ctx.channels.serve({ list: (limit) => planList(ctx.storage.db, limit) });
});
