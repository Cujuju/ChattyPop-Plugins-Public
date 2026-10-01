// Plan usage's app totals follow the plugins reporting AI usage, whatever the provider's plan-limit read is doing.
import { describe, expect, it, vi } from 'vitest';
import type { AppUsage, PlanUsageWindow } from '@shared/contract';

// The client runtime, so resources react as in a window (node resolves solid-js to its server build).
// A dynamic import, resolved from the checkout; createRequire would resolve from this folder. By variable: it has no types.
vi.mock('solid-js', () => {
  const client = 'solid-js/dist/solid.js';
  return import(client);
});

const HOUR_MS = 3_600_000;
const WINDOW: PlanUsageWindow = { id: '5h', label: '5 hours', usedPercent: 1, resetsAt: '2026-09-29T12:00:00Z', durationMs: 5 * HOUR_MS };
const env = vi.hoisted(() => ({
  emit: null as null | ((e: { type: string }) => void),
  planUsage: {} as Record<string, () => Promise<PlanUsageWindow[] | null>>,
  planReads: [] as string[],
  runs: 0,
}));
const usage = (runs: number): AppUsage => ({ runs, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });

vi.stubGlobal('window', {
  chattypop: {
    onEvent: (listener: (e: { type: string }) => void) => void (env.emit = listener),
    core: {
      aiPlanUsage: (id: string) => {
        env.planReads.push(id);
        return env.planUsage[id]!();
      },
      aiUsageSince: async () => usage(env.runs),
    },
  },
});

// Renderer modules: imported by path so the node type-check doesn't follow them. The kit re-exports the host's
// plan-limit store, which stands in for it.
const HOST_USAGE = '@/state/providerUsage';
vi.mock('@plugin-sdk/renderer/kit', async () => ({
  ...((await import(HOST_USAGE)) as object),
  aiProviders: () => [{ id: 'claude', planUsage: true }],
  aiSettings: () => ({ providers: { claude: { enabled: true } } }),
}));
vi.mock('@plugin-sdk/renderer', async () => ({
  aiUsageSince: async () => usage(env.runs),
  isActive: () => true,
}));

/** Lets awaited continuations and resource loads run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('Plan usage app totals', () => {
  it("drop a plugin's runs as soon as it turns off, while the plan limits reload or after they fail", async () => {
    env.planUsage.claude = async () => [WINDOW];
    env.runs = 7;
    const statePath = '../renderer/state.ts';
    const { appTokens } = (await import(statePath)) as { appTokens(): Record<string, Record<string, AppUsage>> | undefined };
    await settle();
    expect(appTokens()?.claude?.['5h']?.runs).toBe(7);

    // Summaries turns off: its runs leave the totals; the provider's plan-limit read is still pending.
    env.runs = 0;
    env.planUsage.claude = () => new Promise(() => undefined);
    env.emit!({ type: 'plugins-changed' });
    await settle();
    expect(appTokens()?.claude?.['5h']?.runs).toBe(0);

    // A failed plan-limit read leaves the last windows to total against.
    env.runs = 3;
    env.planUsage.claude = async () => {
      throw new Error('offline');
    };
    env.emit!({ type: 'plugins-changed' });
    await settle();
    expect(appTokens()?.claude?.['5h']?.runs).toBe(3);
  });
});
