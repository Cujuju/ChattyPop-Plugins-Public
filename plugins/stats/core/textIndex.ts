import type { ArchiveRead, RollupRow } from '@plugin-sdk/core';

/** Exact cumulative frequencies and selected-term series; no vocabulary truncation. */
export async function textIndex(channel: string, read: ArchiveRead, signal: AbortSignal, data: any): Promise<RollupRow[]> {
  const rows = await read<any>(data.config.sql, [channel]);
  const out: any[] = [], identities = new Map<string, any>(), people = new Map<string, any>(), months: string[] = [], terms = new Map<string, any>(), summaries = new Map<string, any>(), longest = new Map<string, any>();
  if (rows.length) {
    const cursor = new Date(rows[0].day.slice(0, 'YYYY-MM'.length) + '-01T00:00:00Z');
    const last = rows.at(-1).day.slice(0, 'YYYY-MM'.length);
    for (let month = cursor.toISOString().slice(0, 'YYYY-MM'.length); month <= last; month = cursor.toISOString().slice(0, 'YYYY-MM'.length)) {
      months.push(month); cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const order = (a: any, b: any) => a.seq - b.seq || a.position - b.position;
  const add = (r: any, author: string) => {
    const key = JSON.stringify([author, r.day, r.date, r.kind, r.term]);
    let s = summaries.get(key);
    if (!s) { s = { ...r, author_id: author, n: 0, payload: r.kind === 'lengths' ? new Map() : JSON.parse(r.payload) }; summaries.set(key, s); }
    s.n += r.n; s.first_ts = Math.min(s.first_ts, r.first_ts); s.last_ts = Math.max(s.last_ts, r.last_ts);
    if (r.kind === 'extent' && JSON.parse(r.payload).name < s.payload.name) s.payload = JSON.parse(r.payload);
    if (r.kind === 'emoji' && order(r, s) < 0) { s.seq = r.seq; s.position = r.position; s.payload = JSON.parse(r.payload); }
    if (r.kind === 'lengths') for (const [length, n, positive, negative] of JSON.parse(r.payload)) {
      const counts = s.payload.get(length) ?? [length, 0, 0, 0];
      counts[1] += n; counts[2] += positive; counts[3] += negative; s.payload.set(length, counts);
    }
  };
  for (const r of rows) {
    signal.throwIfAborted();
    if (r.kind === 'words') {
      for (const [word, n, seq, position] of JSON.parse(r.payload)) {
        let t = terms.get(word);
        if (!t) { t = { term: word, n: 0, seq, position, months: new Map(), series: new Map() }; terms.set(word, t); }
        t.n += n;
        if (order({ seq, position }, t) < 0) { t.seq = seq; t.position = position; }
        const month = r.day.slice(0, 'YYYY-MM'.length), m = t.months.get(month) ?? new Map();
        m.set(r.day, (m.get(r.day) ?? 0) + n); t.months.set(month, m);
        const key = JSON.stringify([r.day, r.date]), s = t.series.get(key) ?? [r.day, r.date, 0, seq, position];
        s[2] += n;
        if (order({ seq, position }, { seq: s[3], position: s[4] }) < 0) { s[3] = seq; s[4] = position; }
        t.series.set(key, s);
      }
    } else if (r.kind === 'longest') {
      for (const [kind, day] of [['candidate', r.day], ['longest', r.day.slice(0, 'YYYY-MM'.length)]]) {
        const key = JSON.stringify([kind, day]);
        const l = longest.get(key) ?? { ...r, kind, author_id: '', day, date: '', payload: [] };
        l.payload = l.payload.concat(JSON.parse(r.payload)).sort((a: any, b: any) => b.words - a.words || a.ts - b.ts || a.messageId.localeCompare(b.messageId)).slice(0, data.config.top);
        longest.set(key, l);
      }
    } else {
      add(r, '');
      if (r.kind === 'extent') {
        const prior = identities.get(r.author_id);
        if (!prior || JSON.parse(r.payload).name < JSON.parse(prior.payload).name) identities.set(r.author_id, { ...r, kind: 'identity', day: '', date: '' });
      }
      if (r.kind === 'lengths') for (const [length, n] of JSON.parse(r.payload)) for (const grain of ['person', 'personMonth']) {
        const day = grain === 'person' ? r.day : r.day.slice(0, 'YYYY-MM'.length), key = JSON.stringify([r.author_id, grain, day]);
        const p = people.get(key) ?? { ...r, kind: grain, day, date: '', n: 0, payload: [0, 0] };
        p.payload[0] += n; p.payload[1] += length * n; people.set(key, p);
      }
    }
  }
  const base = { author_id: '', date: '', first_ts: 0, last_ts: 0, before_n: 0 };
  const dictionary: any[] = [], prefixes = new Map<string, any[]>();
  for (const t of terms.values()) {
    dictionary.push([t.term, t.n, t.seq, t.position]);
    out.push({ ...base, date: rows.at(-1)?.day ?? '', kind: 'term', day: '', term: t.term, n: t.n, seq: t.seq, position: t.position, payload: JSON.stringify([...t.series.values()]) });
    let before = 0;
    for (const month of months) {
      const days = t.months.get(month) ?? new Map();
      const n = [...days.values()].reduce((a: number, b: any) => a + b, 0);
      const packed = prefixes.get(month) ?? [];
      packed.push([before, [...days].map(([day, uses]) => [Number(day.slice('YYYY-MM-'.length)), uses])]);
      prefixes.set(month, packed);
      before += n;
    }
  }
  out.push({ ...base, kind: 'dictionary', day: '', term: '', n: 0, seq: 0, position: 0, payload: JSON.stringify([rows.at(-1)?.day ?? '', dictionary]) });
  for (const [day, packed] of prefixes) out.push({ ...base, kind: 'prefixPack', day, term: '', n: 0, seq: 0, position: 0, payload: JSON.stringify(packed) });
  for (const s of [...summaries.values(), ...longest.values(), ...people.values(), ...identities.values()]) {
    const { channel_id: _channel, ...r } = s;
    out.push({ ...r, before_n: 0, payload: typeof s.payload === 'string' ? s.payload : JSON.stringify(s.payload instanceof Map ? [...s.payload.values()] : s.payload) });
  }
  return out;
}
