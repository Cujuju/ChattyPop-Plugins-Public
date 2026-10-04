// Plans' core side: the per-message plan question, its extraction, and the list the panel shows.
import { chosenModel, defineCorePlugin, ProviderUnavailableError, type CoreContext } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { planList, planQuestion, type PlanProvider } from './plans';
import { PLANS_MIGRATIONS } from './schema';

/** Why a hit isn't extracted while Plans has no provider chosen. */
export const NO_PLAN_PROVIDER = 'No AI provider is chosen in Settings → Jev → Detect plans and decisions.';

/** The provider chosen for extraction, with its Settings → AI model and effort; or why there is none. */
function planProvider(ctx: CoreContext<typeof plugin>): PlanProvider | string {
  const id = ctx.preferences.get('settings').defaultProvider;
  if (!id) return NO_PLAN_PROVIDER;
  const settings = ctx.ai.settings();
  try {
    const provider = ctx.ai.provider(id, settings);
    return { complete: (req) => provider.complete({ ...req, ...chosenModel(settings.providers[id]!) }) };
  } catch (err) {
    if (err instanceof ProviderUnavailableError) return `${id}: ${err.message}`;
    throw err;
  }
}

export default defineCorePlugin(plugin, (ctx) => {
  // Hits still to extract are stored, so turning Plans off and on, or quitting, resumes them.
  ctx.storage.migrate(PLANS_MIGRATIONS);
  ctx.jev.questions.register(
    planQuestion({
      db: ctx.storage.db,
      provider: () => planProvider(ctx),
      changed: ctx.archive.changed,
    }),
  );
  ctx.channels.serve({ list: (limit) => planList(ctx.storage.db, limit) });
});
