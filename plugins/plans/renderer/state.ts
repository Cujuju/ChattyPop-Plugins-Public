// Plans' renderer state: the listed plans and decisions, and which of them the owner has seen.
import { plugin } from '../shared';
import type { PlanItem } from '../shared/types';
import {
  ARCHIVE_REFRESH_DEBOUNCE_MS,
  callable,
  desktopCoreClient,
  onAppEvent,
  onAppEventDebounced,
  pluginPreference,
  pluginResource,
} from '@plugin-sdk/renderer';

/** Plans and decisions shown (#67). */
const PLAN_LIMIT = 200;

/** Fetched while this window may call core's list (the plugin is on; not on the phone). */
export const plans = pluginResource(plugin, 'list', () => [PLAN_LIMIT], []);

// New plans arrive with archive changes.
onAppEventDebounced('archive-changed', ARCHIVE_REFRESH_DEBOUNCE_MS, () => void plans.refetch());
onAppEvent('privacy-changed', () => void plans.refetch());

/** Detection can reach older messages (backfill), so seen items are tracked by identity, not by a time watermark. */
const planKey = (p: PlanItem): string => `${p.messageId}:${p.kind}`;
/**
 * Items listed when the Plans panel was last on screen; null until loaded. Nothing stored yet (first run): the items that
 * already exist count as seen, once Plans can be read; an inactive read stores nothing.
 */
const [seenPlans, setSeenPlans] = pluginPreference(plugin, 'seen', {
  // seedWhen holds it to where the list is callable: a desktop window.
  seed: async () => (await desktopCoreClient(plugin).list(PLAN_LIMIT)).map(planKey),
  seedWhen: () => callable(plugin, 'list'),
});

/** Plans and decisions listed since the Plans panel was last on screen. */
export const unseenPlanCount = (): number => {
  const seen = seenPlans();
  if (seen === null) return 0;
  const known = new Set(seen);
  return plans().filter((p) => !known.has(planKey(p))).length;
};

export function markPlansSeen(): void {
  if (plans.loading) return; // the list isn't current yet
  if (seenPlans() === null || unseenPlanCount() > 0) setSeenPlans(plans().map(planKey));
}
