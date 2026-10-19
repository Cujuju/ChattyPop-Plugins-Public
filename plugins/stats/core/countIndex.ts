import type { ArchiveRead, RollupRow } from '@plugin-sdk/core';

/** Keep identity histories and shared chart histograms separate. */
export async function countIndex(channel: string, read: ArchiveRead, _signal: AbortSignal, data: any): Promise<RollupRow[]> {
  const rows = await read<any>(data.config.sql, [channel]);
  const people = new Map<string, any[]>(), hist = new Map<string, any>();
  for (const r of rows) {
    const p = people.get(r.author_id) ?? []; p.push(r); people.set(r.author_id, p);
    const key = JSON.stringify([r.day, r.date]);
    let h = hist.get(key);
    const payload = JSON.parse(r.payload);
    if (!h) { h = { ...r, author_id: '', payload: { hours: {}, edits: payload.edits.map(() => 0), attachments: payload.attachments.map(() => 0) } }; hist.set(key, h); }
    h.first_ts = Math.min(h.first_ts, r.first_ts); h.last_ts = Math.max(h.last_ts, r.last_ts);
    for (const [hour, n] of Object.entries(payload.hours)) h.payload.hours[hour] = (h.payload.hours[hour] ?? 0) + Number(n);
    payload.edits.forEach((n: number, i: number) => { h.payload.edits[i] += n; });
    payload.attachments.forEach((n: number, i: number) => { h.payload.attachments[i] += n; });
  }
  return [...people].map(([author_id, p]) => ({ author_id, kind: 'rows', payload: JSON.stringify(p) }))
    .concat([{ author_id: '', kind: 'hist', payload: JSON.stringify([...hist.values()].map((h) => ({ ...h, payload: JSON.stringify(h.payload) }))) }]);
}
