// Plans' renderer state: the listed plans and decisions, and which of them the owner has seen.
import { plugin } from '../shared';
import type { PlanItem } from '../shared/types';
import {
  callable,
  coreClient,
  onAppEvent,
  panelShown,
  pageShown,
  pluginPreference,
  pluginResource,
} from '@plugin-sdk/renderer';

/** Plans and decisions shown (#67). */
const PLAN_LIMIT = 200;

/** Fetched while this window may call core's list (the plugin is on). */
export const plans = pluginResource(plugin, 'list', () => [PLAN_LIMIT], [], { refreshOn: { kinds: ['plugin', 'deletes', 'names'], pluginIds: [plugin.manifest.id] }, shown: panelShown('plans') });


/** Detection can reach older messages (backfill), so seen items are tracked by identity, not by a time watermark. */
const planKey = (p: PlanItem): string => `${p.messageId}:${p.kind}`;
const keys = pluginResource(plugin, 'keys', () => [PLAN_LIMIT], [] as string[], { refreshOn: { kinds: ['plugin', 'deletes'], pluginIds: [plugin.manifest.id] }, shown: pageShown });
onAppEvent('privacy-changed', () => { plans.mutate([]); keys.mutate([]); void plans.refetch(); void keys.refetch(); });
/** Last-visible Plans items; null until loaded. First successful read marks existing items seen. Inactive reads store nothing. */
const [seenPlans, setSeenPlans] = pluginPreference(plugin, 'seen', {
  // Seeding waits until this window can read the list.
  seed: async () => await coreClient(plugin).keys(PLAN_LIMIT),
  seedWhen: () => callable(plugin, 'keys') && pageShown(),
});

/** Plans' settings: the provider that extracts each detected plan. */
export const [plansSettings, , { patch: patchPlansSettings }] = pluginPreference(plugin, 'settings');

/** Plans and decisions listed since the Plans panel was last on screen. */
export const unseenPlanCount = (): number => {
  const seen = seenPlans();
  if (seen === null) return 0;
  const known = new Set(seen);
  return keys().filter((key) => !known.has(key)).length;
};

export function markPlansSeen(): void {
  if (plans.loading) return; // the list isn't current yet
  if (seenPlans() === null || unseenPlanCount() > 0) setSeenPlans(plans().map(planKey));
}
