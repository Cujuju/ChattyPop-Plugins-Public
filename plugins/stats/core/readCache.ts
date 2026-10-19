import type { ArchiveRead } from '@plugin-sdk/core';

const MAX_READS = 64; // Bound retained results across section, scope, author and exact range choices.
const caches = new WeakMap<ArchiveRead, Map<string, unknown>>();

/** Only clean, revalidated snapshots are cached; visibility and zone changes alter the host's opaque token. */
export async function cachedStats<T>(read: ArchiveRead, key: string | null, current: () => boolean, load: () => Promise<T>): Promise<T> {
  const cache = caches.get(read) ?? new Map<string, unknown>();
  caches.set(read, cache);
  if (key && cache.has(key) && current()) return structuredClone(cache.get(key)) as T;
  const value = await load();
  if (key && current()) {
    cache.set(key, structuredClone(value));
    while (cache.size > MAX_READS) cache.delete(cache.keys().next().value!);
  }
  return value;
}
