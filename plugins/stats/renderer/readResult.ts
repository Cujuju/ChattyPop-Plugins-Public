import type { PluginResource } from '@plugin-sdk/renderer';
import type { AnalyticsRead } from '../shared/readResult';

/** Preserve data selectors while exposing the shared publication envelope to pending/progress UI. */
export function analyticsResource<T>(resource: PluginResource<AnalyticsRead<T> | null>) {
  const result = () => resource()?.data ?? null;
  return Object.defineProperties(result, {
    loading: { get: () => resource.loading }, failure: { get: () => resource.failure },
    refetch: { value: () => resource.refetch() }, result: { value: resource },
    mutate: { value: (data: T | null) => resource.mutate({ ...(resource() ?? { building: false, done: 0, total: 0 }), data }) },
  }) as PluginResource<T | null> & { result: typeof resource };
}

/** A data selector with its publication envelope. */
export type AnalyticsResource<T> = ReturnType<typeof analyticsResource<T>>;
