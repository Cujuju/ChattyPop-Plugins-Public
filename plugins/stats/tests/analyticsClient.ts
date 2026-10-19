import type { TestPlugin } from '@plugin-sdk/core/testing';
import { plugin, type StatsCoreCalls, type AnalyticsRead } from '../shared';

const SETTLE_MS = 20_000; // Existing data contracts assert settled results; pending behavior has its own tests.
const POLL_MS = 10; // Yield while background rollups publish the fixture.
type Data<T> = T extends AnalyticsRead<infer R> ? R : T;
type Client = { [K in keyof StatsCoreCalls]: (...args: Parameters<StatsCoreCalls[K]>) => Promise<Data<Awaited<ReturnType<StatsCoreCalls[K]>>>> };

export function analyticsClient(t: Pick<TestPlugin<typeof plugin>, 'client'>): Client {
  const client = t.client('renderer');
  return new Proxy(client, { get(target, key: keyof StatsCoreCalls) {
    const call = target[key] as (...args: unknown[]) => Promise<unknown>;
    if (key === 'rollupStatus' || key === 'rebuildRollups') return call;
    return async (...args: unknown[]) => {
      const started = performance.now();
      for (;;) {
        const state = await target.rollupStatus();
        if (state.error) throw new Error(state.error);
        if (!state.building) {
          const result = await call(...args) as AnalyticsRead<unknown>;
          if (!result.building && result.data !== null) return result.data;
        }
        if (performance.now() - started > SETTLE_MS) throw new Error('Analytics did not publish the fixture');
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    };
  } }) as unknown as Client;
}
