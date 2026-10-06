// The providers Plan usage shows, and what ChattyPop itself used in each of their plan windows.
import { aiUsageSince, isActive } from '@plugin-sdk/renderer';
import { aiProviders, aiSettings, lastPlanUsageOf, usageReporters } from '@plugin-sdk/renderer/kit';
import { createResource } from 'solid-js';
import { plugin } from '../shared';
import { readUsage, usageReads } from './usageReads';

const active = (): boolean => isActive(plugin);

/** Enabled providers that report plan limits, in Settings → AI order. Reactive. */
export const shownProviders = (): ReturnType<typeof aiProviders> =>
  aiProviders().filter((d) => d.planUsage && aiSettings().providers[d.id]?.enabled);

/** Reads completed ChattyPop runs/tokens for displayed providers and windows while Plan usage is enabled. Provider changes refresh the last-read windows. */
export const [appTokens] = createResource(
  () => {
    usageReporters();
    if (!active()) return undefined;
    return usageReads(shownProviders().map((d) => ({ provider: d.id, windows: lastPlanUsageOf(d.id) })));
  },
  (reads) => readUsage(reads, aiUsageSince, active),
);
