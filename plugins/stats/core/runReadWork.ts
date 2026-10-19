import type { ArchiveRead } from '@plugin-sdk/core';

/** Run histories and projection maps stay in the worker; only the bounded graph and role rankings cross to Core. */
export async function runReadWork(_part: null, read: ArchiveRead, signal: AbortSignal, data: any): Promise<any[]> {
  const residual = data.view ? await read(`SELECT 1 FROM archive_residual_messages m WHERE ${data.sql} LIMIT 1`, data.params) : [];
  const rows = data.view && !residual.length
    ? await read(data.rowsSql, data.rowsParams)
    : await new Function(`return (${data.compute})`)()(null, read, signal, data);
  signal.throwIfAborted();
  return [await new Function(`return (${data.projector})`)()(rows, read, data.config)];
}
