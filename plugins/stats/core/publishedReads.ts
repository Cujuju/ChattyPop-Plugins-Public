import type { AnalyticsRead } from '../shared/readResult';
import type { StatsRollups } from './rollups';
import { AnalyticsPending } from './pending';
import { MAX_CACHE_BYTES } from './readCache';

const MAX_PUBLISHED_READS = 64; // Match the projection cache's bounded set of exact queries.

export function analyticsProgress(rollups: StatsRollups) {
  const states = Object.values(rollups).map((r) => r.status());
  const total = states.reduce((n, s) => n + s.total, 0), dirty = states.reduce((n, s) => n + s.dirty, 0);
  const done = states.reduce((n, s) => n + (s.building && !s.dirty ? 0 : Math.max(0, s.total - s.dirty)), 0);
  return { building: states.some((s) => s.building), maintaining: states.some((s) => s.maintaining), dirty, total, done, error: states.find((s) => s.error)?.error ?? null };
}

/** Never start an archive read while building; retain only results safe under current privacy and zone state. */
export function publishedReads(rollups: StatsRollups) {
  const cache = new Map<string, { data: unknown; bytes: number }>();
  let visibility = '', bytes = 0;
  const syncVisibility = () => {
    const token = rollups.text.visibilityToken();
    if (token !== visibility) { cache.clear(); bytes = 0; visibility = token; }
    return token;
  };
  return async <T>(member: string, query: unknown, load: () => Promise<T>): Promise<AnalyticsRead<T>> => {
    const relative = query && typeof query === 'object' && 'range' in query && query.range;
    const token = syncVisibility(), key = JSON.stringify([member, relative ? { ...query as object, sinceTs: undefined } : query]);
    const pending = (): AnalyticsRead<T> => {
      syncVisibility();
      const { done, total } = analyticsProgress(rollups);
      return { data: structuredClone(cache.get(key)?.data ?? null) as T | null, building: true, done, total };
    };
    if (analyticsProgress(rollups).building) return pending();
    let data: T;
    try { data = await load(); }
    catch (e) { if (e instanceof AnalyticsPending) return pending(); throw e; }
    if (syncVisibility() !== token || analyticsProgress(rollups).building) return pending();
    const size = Buffer.byteLength(JSON.stringify(data));
    if (size <= MAX_CACHE_BYTES) {
      bytes -= cache.get(key)?.bytes ?? 0; cache.delete(key);
      cache.set(key, { data: structuredClone(data), bytes: size }); bytes += size;
      while (cache.size > MAX_PUBLISHED_READS || bytes > MAX_CACHE_BYTES) {
        const first = cache.keys().next().value!; bytes -= cache.get(first)!.bytes; cache.delete(first);
      }
    }
    const { done, total } = analyticsProgress(rollups);
    return { data, building: false, done, total };
  };
}
