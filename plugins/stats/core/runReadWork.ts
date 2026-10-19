import type { ArchiveRead } from '@plugin-sdk/core';

/** Run histories and projection maps stay in the worker; only the bounded graph and role rankings cross to Core. */
export async function runReadWork(_part: null, read: ArchiveRead, signal: AbortSignal, data: any): Promise<any[]> {
  const residual = data.view ? await read<any>(`SELECT m.channel_id, m.ts FROM archive_residual_messages m WHERE ${data.sql}`, data.params) : [];
  const compute = new Function(`return (${data.compute})`)();
  let rows: any[];
  if (!data.view) rows = await compute(null, read, signal, data);
  else {
    let dirty = data.liveSql ? await read<any>(data.liveSql, data.rowsParams) : [];
    if (residual.length) {
      dirty = dirty.concat(await read<any>(data.residualPartsSql, [JSON.stringify(residual), data.gapMs, data.gapMs, ...(data.firstDay ? [data.firstDay] : [])]));
      for (const r of residual) {
        const day = new Date(r.ts).toISOString().slice(0, 'YYYY-MM-DD'.length);
        if (!data.firstDay || day >= data.firstDay) dirty.push({ channel_id: r.channel_id, day });
      }
    }
    const parts = new Map(dirty.map((p) => [JSON.stringify([p.channel_id, p.day]), p]));
    const skip = new Set(parts.keys());
    rows = (await read<any>(data.rowsSql, data.rowsParams)).filter((r) => !skip.has(JSON.stringify([r.channel_id, r.day])));
    const visibleRead: ArchiveRead = (sql, params, options) => read(sql.replaceAll('archive_all_rollup_messages', 'archive_messages'), params, options);
    for (const p of parts.values()) {
      const startTs = Date.parse(p.day + 'T00:00:00Z');
      const live = await compute({ channelId: p.channel_id, day: p.day, startTs, endTs: startTs + data.dayMs, timeZone: data.timeZone }, visibleRead, signal, data);
      rows = rows.concat(live.map((r: any) => ({ ...r, channel_id: p.channel_id })));
    }
  }
  signal.throwIfAborted();
  return [await new Function(`return (${data.projector})`)()(rows, read, data.config)];
}
