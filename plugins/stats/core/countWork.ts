import type { ArchiveRead, RollupPartition } from '@plugin-sdk/core';

export interface CountRow {
  channel_id: string; day?: string; author_id: string; date: string; kind: string; url: string;
  n: number; text_n: number; edited_n: number; attachment_n: number; linked_n: number;
  first_ts: number; last_ts: number; first_id: string; name: string; payload: string;
}
export interface CountData {
  outputKind?: string; mode?: 'read'; view?: string; rowsSql?: string; channelsSql?: string; rowsParams?: unknown[]; sql?: string; params?: (string | number)[]; cuts?: number[];
  timeZone?: string; projector?: string; config?: unknown; dayMs: number; editLimits: (number | null)[]; kinds: readonly string[];
}

/** Runs in the archive worker; daily rows retain local-day histograms and exact timestamp bounds. */
export async function countWork(part: RollupPartition | null, read: ArchiveRead, signal: AbortSignal, data: CountData): Promise<Omit<CountRow, 'channel_id' | 'day'>[]> {
  let summaries: any[] = [];
  const cuts = data.cuts ?? [];
  const boundaryDays = [...new Set(cuts.map((ts) => Math.floor(ts / data.dayMs) * data.dayMs))];
  const params = part ? [part.channelId, part.startTs, part.endTs] : data.params!;
  const where = part ? 'm.channel_id = ? AND m.ts >= ? AND m.ts < ?' : data.sql!;

  let live = where;
  if (!part && data.view) {
    const days = boundaryDays.map((ts) => new Date(ts).toISOString().slice(0, 'YYYY-MM-DD'.length));
    summaries = summaries.concat(await read<any>(data.rowsSql!,
      data.rowsParams ?? [...params, JSON.stringify(days)]));

  }
  const columns = `m.id, m.channel_id, m.author_id, m.author_plain_name AS name, m.ts, m.edited_ts,
    trim(m.content, char(9) || char(10) || char(13) || ' ') != '' AS text_n
   `;
  let messages = await read<any>(part ? `SELECT ${columns} FROM archive_all_rollup_messages m WHERE ${live}`
    : data.view ? `SELECT ${columns} FROM archive_residual_messages m WHERE ${where}` : `SELECT ${columns} FROM archive_messages m WHERE ${live}`, params);
  const boundaryChannels = !part && data.view && boundaryDays.length ? await read<{ channel_id: string }>(data.channelsSql!, params) : [];
  if (!part && data.view) for (const start of boundaryDays) messages = messages.concat(await read<any>(`SELECT ${columns}
    FROM json_each(?) c CROSS JOIN archive_rollup_messages m ON m.channel_id = c.value WHERE ${where} AND m.ts >= ? AND m.ts < ?`, [JSON.stringify(boundaryChannels.map((c) => c.channel_id)), ...params, start, start + data.dayMs]));
  const calendar = new Intl.DateTimeFormat('sv-SE', { timeZone: part?.timeZone ?? data.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  for (const m of messages) { const local = calendar.format(m.ts); m.date = local.slice(0, 'YYYY-MM-DD'.length); m.hour = Number(local.slice(-'HH'.length)); }
  const ids = JSON.stringify(messages.map((m) => m.id));
  const attachments = await read<any>(`SELECT a.message_id, a.content_type FROM archive_all_attachments a WHERE a.message_id IN (SELECT value FROM json_each(?))`, [ids]);
  const shares = await read<any>(`SELECT ml.message_id, l.url FROM archive_all_message_links ml JOIN archive_all_links l ON l.id = ml.link_id WHERE ml.message_id IN (SELECT value FROM json_each(?))`, [ids]);
  const byId = new Map(messages.map((m) => [m.id, m]));
  const files = new Map<string, any[]>();
  for (const a of attachments) { const list = files.get(a.message_id) ?? []; list.push(a); files.set(a.message_id, list); }
  const urls = new Map<string, string[]>();
  for (const s of shares) { const list = urls.get(s.message_id) ?? []; list.push(s.url); urls.set(s.message_id, list); }
  const groups = new Map<string, any>();
  for (const m of messages) {
    signal.throwIfAborted();
    const key = JSON.stringify([m.channel_id, m.author_id, m.date, cuts.filter((cut) => m.ts >= cut).length]);
    let row = groups.get(key);
    if (!row) {
      row = { channel_id: m.channel_id, author_id: m.author_id, date: m.date, kind: 'message', url: '', n: 0, text_n: 0, edited_n: 0,
        attachment_n: 0, linked_n: 0, first_ts: m.ts, last_ts: m.ts, first_id: m.id, name: m.name,
        hours: {}, edits: data.editLimits.map(() => 0), attachments: data.kinds.map(() => 0) };
      groups.set(key, row);
    }
    row.n++; row.text_n += m.text_n; row.edited_n += Number(m.edited_ts !== null);
    row.first_ts = Math.min(row.first_ts, m.ts); row.last_ts = Math.max(row.last_ts, m.ts);
    if (m.name < row.name) row.name = m.name;
    row.hours[m.hour] = (row.hours[m.hour] ?? 0) + 1;
    if (m.edited_ts !== null) row.edits[data.editLimits.findIndex((limit) => limit === null || m.edited_ts - m.ts < limit)]++;
    const attached = files.get(m.id) ?? [];
    if (attached.length) row.attachment_n++;
    for (const a of attached) {
      const type = (a.content_type ?? '').toLowerCase().split('/')[0];
      const kind = data.kinds.includes(type) ? type : 'other';
      row.attachments[data.kinds.indexOf(kind)]++;
    }
    if (urls.has(m.id)) row.linked_n++;
  }
  for (const s of shares) {
    const m = byId.get(s.message_id)!;
    const key = JSON.stringify([m.channel_id, m.author_id, part ? '' : m.date, s.url, cuts.filter((cut) => m.ts >= cut).length]);
    let row = groups.get(key);
    if (!row) { row = { channel_id: m.channel_id, author_id: m.author_id, date: m.date, kind: 'link', url: s.url,
      n: 0, text_n: 0, edited_n: 0, attachment_n: 0, linked_n: 0, first_ts: m.ts, last_ts: m.ts, first_id: m.id, name: m.name,
      hours: {}, edits: [], attachments: [] }; groups.set(key, row); }
    row.n++; row.last_ts = Math.max(row.last_ts, m.ts);
    if (m.name < row.name) row.name = m.name;
    if (m.ts < row.first_ts || (m.ts === row.first_ts && (m.id.length < row.first_id.length || (m.id.length === row.first_id.length && m.id < row.first_id)))) {
      row.first_ts = m.ts; row.first_id = m.id;
    }
  }
  for (const { hours, edits, attachments: attached, ...row } of groups.values()) summaries.push({ ...row, payload: JSON.stringify({ hours, edits, attachments: attached }) });
  if (!part && data.projector) return new Function(`return (${data.projector})`)()(summaries, read, data.config);
  return part ? summaries.filter((r) => !data.outputKind || r.kind === data.outputKind).map(({ channel_id: _channel, ...row }) => row) : summaries;
}
