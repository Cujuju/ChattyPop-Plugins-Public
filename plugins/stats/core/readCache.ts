import type { ArchiveRead } from '@plugin-sdk/core';

const MAX_READS = 64; // Bound retained results across section, scope, author and exact range choices.
export const MAX_CACHE_BYTES = 8 * 1024 * 1024; // Eight MiB bounds retained projections per plugin activation.
const caches = new WeakMap<ArchiveRead, Map<string, { value: unknown; bytes: number }>>();

/** Only clean, revalidated snapshots are cached; visibility and zone changes alter the host's opaque token. */
export async function cachedStats<T>(read: ArchiveRead, key: string | null, current: () => boolean, load: () => Promise<T>): Promise<T> {
  const cache = caches.get(read) ?? new Map<string, { value: unknown; bytes: number }>();
  caches.set(read, cache);
  if (key && cache.has(key) && current()) return structuredClone(cache.get(key)!.value) as T;
  const value = await load();
  if (key && current()) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes <= MAX_CACHE_BYTES) cache.set(key, { value: structuredClone(value), bytes });
    let retained = [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (cache.size > MAX_READS || retained > MAX_CACHE_BYTES) {
      const oldest = cache.keys().next().value!;
      retained -= cache.get(oldest)!.bytes; cache.delete(oldest);
    }
  }
  return value;
}
