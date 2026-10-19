import type { ArchiveRead } from '@plugin-sdk/core';

/** Prefix seeks bound lexical work by vocabulary and boundary days. */
export async function textIndexRead(read: ArchiveRead, data: any, cuts: number[], midpoint: number | null | undefined, choices?: string[]): Promise<any[]> {
  const utc = (ts: number) => Math.floor(ts / data.dayMs) * data.dayMs;
  const day = (ts: number) => new Date(ts).toISOString().slice(0, 'YYYY-MM-DD'.length);
  const excluded = [...new Set(cuts.map((ts) => day(utc(ts))))];
  const first = data.sinceTs === null ? data.firstDay : day(Math.ceil(data.sinceTs / data.dayMs) * data.dayMs);
  const last = data.untilTs === null ? data.lastDay : day(utc(data.untilTs));
  const bind = { ...data.indexSql.params, first, last, excluded: JSON.stringify(excluded) };
  if (choices) {
    const named = await read<any>(data.indexSql.series, { ...bind, choices: JSON.stringify(choices) });
    const rows = new Map<string, any>(), skip = new Set(excluded);
    for (const r of named) for (const [utcDay, date, n, seq, position] of JSON.parse(r.payload)) {
      if (utcDay < first || utcDay >= last || skip.has(utcDay)) continue;
      const p = rows.get(date) ?? { kind: 'words', date, tokens: [] };
      p.tokens.push([r.term, n, seq, position]); rows.set(date, p);
    }
    return [...rows.values()];
  }
  if (midpoint == null) {
    const rows = await read<any>(data.indexSql.summary, bind);
    if (data.section !== 'words' || midpoint === undefined) return rows;
    const edgeMonths = [...new Set(excluded.map((d) => d.slice(0, 'YYYY-MM'.length)))];
    const edges = { ...bind, firstMonth: first.slice(0, 'YYYY-MM'.length), lastMonth: last.slice(0, 'YYYY-MM'.length), edges: JSON.stringify(edgeMonths) };
    const longest = await read<any>(data.indexSql.longest, edges);
    const candidates = await read<any>(data.indexSql.candidates, edges);
    const identities = await read<any>(data.indexSql.identities, data.indexSql.params);
    const personMonths = await read<any>(data.indexSql.personMonths, edges);
    const personDays = await read<any>(data.indexSql.personDays, edges);
    return rows.concat(longest, candidates.map((r) => ({ ...r, kind: 'longest' })), identities, personMonths, personDays);
  }
  const middle = day(utc(midpoint)), after = day(utc(midpoint) + data.dayMs);
  const dictionaries = await read<any>(data.indexSql.counts, data.indexSql.params);
  const words: any[] = [];
  for (const r of dictionaries) {
    const [last_day, terms] = JSON.parse(r.payload);
    for (const [index, [term, n, seq, position]] of terms.entries()) words.push({ channel_id: r.channel_id, index, term, n, seq, position, last_day });
  }
  const limits = [first, middle, after, last];
  const months = [...new Set(limits.filter((d) => d !== data.firstDay && d !== data.lastDay).map((d) => d.slice(0, 'YYYY-MM'.length)))];
  const prefixes = await read<any>(data.indexSql.prefixes, { ...data.indexSql.params, months: JSON.stringify(months) });
  const known = new Map<string, any>();
  for (const r of prefixes) {
    let channel = known.get(r.channel_id); if (!channel) { channel = new Map(); known.set(r.channel_id, channel); }
    channel.set(r.day, JSON.parse(r.payload));
  }
  const count = (r: any, cut: string) => {
    if (cut === data.firstDay) return 0;
    if (cut === data.lastDay) return r.n;
    const p = known.get(r.channel_id)?.get(cut.slice(0, 'YYYY-MM'.length))?.[r.index];
    if (!p) return cut > r.last_day ? r.n : 0;
    const limit = Number(cut.slice('YYYY-MM-'.length));
    return p[0] + p[1].reduce((n: number, [day, uses]: [number, number]) => n + (day < limit ? uses : 0), 0);
  };
  const earlier: any[] = [], later: any[] = [];
  for (const r of words) {
    const a = count(r, middle) - count(r, first), b = count(r, last) - count(r, after);
    if (a > 0) earlier.push([r.term, a, r.seq, r.position]);
    if (b > 0) later.push([r.term, b, r.seq, r.position]);
  }
  return [
    { kind: 'words', date: '', aggregate: true, first_ts: midpoint - 1, tokens: earlier },
    { kind: 'words', date: '', aggregate: true, first_ts: midpoint, tokens: later },
  ];
}
