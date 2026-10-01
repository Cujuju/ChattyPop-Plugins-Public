// Which plan windows' app usage to read, and reading them: only while Plan usage is on (component-free, for tests).
import type { AppUsage, PlanUsageWindow, ProviderId } from '@plugin-sdk/shared';

/** A provider's plan windows as last read: null when it reports no plan limits, undefined before its first read. */
export interface PlanWindows {
  provider: ProviderId;
  windows: PlanUsageWindow[] | null | undefined;
}

/** One provider's windows to read ChattyPop's use in. */
export interface UsageRead {
  id: ProviderId;
  windows: PlanUsageWindow[];
}

/** ChattyPop's use per provider, then per window id. */
export type AppUsageByProvider = Record<ProviderId, Record<string, AppUsage>>;

/** What to read: each provider that reported windows; undefined (nothing) when none did. */
export const usageReads = (usages: PlanWindows[]): UsageRead[] | undefined => {
  const reads = usages.flatMap((u) => (u.windows?.length ? [{ id: u.provider, windows: u.windows }] : []));
  return reads.length ? reads : undefined;
};

/** ChattyPop's use in each window with a known start; stops reading once Plan usage turns off. */
export async function readUsage(
  reads: UsageRead[],
  read: (provider: ProviderId, sinceTs: number) => Promise<AppUsage>,
  active: () => boolean,
): Promise<AppUsageByProvider> {
  const out: AppUsageByProvider = {};
  for (const { id, windows } of reads) {
    const byWindow: Record<string, AppUsage> = (out[id] = {});
    for (const w of windows) {
      if (!active()) return out;
      if (!w.resetsAt || w.durationMs === null) continue;
      byWindow[w.id] = await read(id, Date.parse(w.resetsAt) - w.durationMs);
    }
  }
  return out;
}
