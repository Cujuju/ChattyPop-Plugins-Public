import type { ArchiveRead, PluginDb } from '@plugin-sdk/core';

/** Benchmark-only synchronous oracle profiles historical SQL and current full folds through the same statement recorder. */
export function referenceRead(db: PluginDb): ArchiveRead {
  const read = async <R,>(sql: string, params: readonly unknown[] | Record<string, unknown> = [], options: NonNullable<Parameters<ArchiveRead>[2]> = {}): Promise<R[]> => {
    options.signal?.throwIfAborted();
    if (options.fold) return new Function(`return (${options.fold.source})`)()(null, read, options.signal ?? new AbortController().signal, options.fold.data);
    const statement = db.prepare(sql);
    return (Array.isArray(params) ? statement.all(...params) : statement.all(params)) as R[];
  };
  return Object.assign(read, { prepare: db.prepare.bind(db), transaction: db.transaction.bind(db), open: db.open });
}
