import type { ArchiveRead } from '@plugin-sdk/core';

/** Worker-only aggregation keeps tokenization, frequency maps and boundary folds off Core. */
export async function textReadWork(_part: null, read: ArchiveRead, signal: AbortSignal, data: any): Promise<any[]> {
  const metrics: { sql: string; rows: number; ms: number }[] = [];
  if (data.profile) {
    const underlying = read;
    read = async (sql, params, options) => {
      const started = performance.now(), result = await underlying(sql, params, options);
      metrics.push({ sql, rows: result.length, ms: performance.now() - started }); return result as any;
    };
  }
  const finish = (result: any[]) => { if (data.profile) result[0].benchmarkSql = metrics; return result; };
  const fold = new Function(`return (${data.compute})`)();
  const utcDay = (ts: number) => Math.floor(ts / data.dayMs) * data.dayMs;
  const dayName = (ts: number) => new Date(ts).toISOString().slice(0, 'YYYY-MM-DD'.length);
  const cuts: number[] = data.cuts;
  const days = new Set(cuts.map(utcDay));
  let boundaryChannels: string[] | undefined;
  const liveRows = async (extra: number[] = []) => {
    extra.forEach((ts) => days.add(utcDay(ts)));
    const config = { ...data.config, sql: data.sql, params: data.params, cuts: [...cuts, ...extra] };
    if (!data.view) return fold(null, read, signal, config);
    if (days.size && !boundaryChannels) boundaryChannels = (await read<any>(data.channelsSql, data.memberParams)).map((r) => r.channel_id);
    let fragments = await fold(null, read, signal, { ...config, mode: 'residual' });
    for (const startTs of days) fragments = fragments.concat(await fold(null, read, signal, { ...config, mode: 'boundary', boundaryChannels, startTs, endTs: startTs + data.dayMs }));
    return fragments;
  };
  let rows: any[] = data.view ? await read(data.rowsSql,
    [...data.memberParams, JSON.stringify([...days].map(dayName))]) : [];
  rows = rows.concat(await liveRows());
  const lengths = rows.filter((r) => r.kind === 'lengths');
  const first = lengths.reduce((v, r) => Math.min(v, r.first_ts), Infinity);
  const last = lengths.reduce((v, r) => Math.max(v, r.last_ts), -Infinity);
  const midpoint = first === Infinity ? null : first + (last - first) / data.halves;
  if (midpoint !== null && data.section === 'words') {
    const midpointDay = dayName(midpoint);
    rows = rows.filter((r) => r.day && r.day !== midpointDay && !days.has(utcDay(r.first_ts)));
    rows = rows.concat(await liveRows([midpoint]));
  }
  const expanded: any[] = [];
  for (const r of rows) {
    if (r.kind === 'lengths') for (const [n, count, positive, negative] of JSON.parse(r.payload)) expanded.push({ ...r, kind: 'length', term: String(n), n: count, payload: { positive, negative } });
    else { if (r.kind === 'words') r.tokens = JSON.parse(r.payload); expanded.push(r); }
  }
  rows = expanded;
  const extents = rows.filter((r) => r.kind === 'extent');
  const extentFirst = extents.reduce((v, r) => Math.min(v, r.first_ts), Infinity);
  const extentLast = extents.reduce((v, r) => Math.max(v, r.last_ts), -Infinity);
  const bucket = extentFirst !== Infinity && (extentLast - (data.sinceTs ?? extentFirst)) / data.dayMs > data.maxDayBuckets ? 'week' : 'day';
  const dateName = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const bucketNames = new Map<string, string>();
  const bucketName = (start: string) => {
    const prior = bucketNames.get(start); if (prior !== undefined) return prior;
    const date = new Date(start + 'T00:00:00');
    if (bucket === 'week') date.setDate(date.getDate() - (date.getDay() + data.weekDays - 1) % data.weekDays);
    const result = dateName(date); bucketNames.set(start, result); return result;
  };
  const fill = (counts: Map<string, any>, empty: (start: string) => any) => {
    const starts = [...counts.keys()].sort();
    const out: any[] = [];
    if (!starts.length) return out;
    const date = new Date(starts[0] + 'T00:00:00');
    for (let start = dateName(date); start <= starts.at(-1)!; start = dateName(date)) {
      out.push(counts.get(start) ?? empty(start)); date.setDate(date.getDate() + (bucket === 'week' ? data.weekDays : 1));
    }
    return out;
  };
  const median = (counts: Map<number, number>, n: number) => {
    if (!n) return 0;
    const lo = Math.floor((n - 1) / data.halves), hi = Math.floor(n / data.halves);
    let seen = 0, lower = 0;
    for (const [v, n] of [...counts].sort(([a], [b]) => a - b)) {
      if (seen <= lo && seen + n > lo) lower = v;
      if (seen + n > hi) return (lower + v) / data.halves;
      seen += n;
    }
    return 0;
  };
  const identity = new Map<string, any>();
  for (const r of extents) {
    const name = JSON.parse(r.payload).name;
    const p = identity.get(r.author_id);
    if (!p || name < p.name) identity.set(r.author_id, { userId: r.author_id, name, avatar: null });
  }
  if (identity.size) for (const p of await read<any>('SELECT id, avatar FROM archive_users WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify([...identity.keys()])])) identity.get(p.id).avatar = p.avatar;
  const textMessages = rows.filter((r) => r.kind === 'length').reduce((n, r) => n + r.n, 0);
  if (data.section === 'sentiment') {
    const classes = { positive: 0, negative: 0, neutral: 0 };
    const periods = new Map<string, any>();
    for (const r of rows) if (r.kind === 'length') {
      const p = r.payload, start = bucketName(r.date);
      classes.positive += p.positive; classes.negative += p.negative;
      const period = periods.get(start) ?? { start, positive: 0, negative: 0, messages: 0 };
      period.positive += p.positive; period.negative += p.negative; period.messages += r.n; periods.set(start, period);
    }
    classes.neutral = textMessages - classes.positive - classes.negative;
    return finish([{ textMessages, classes, bucket, buckets: fill(periods, (start) => ({ start, positive: 0, negative: 0, messages: 0 })) }]);
  }
  const top = (input: Iterable<any>, limit: number, compare: (a: any, b: any) => number) => {
    const best: any[] = [];
    for (const r of input) {
      let lo = 0, hi = best.length;
      while (lo < hi) { const mid = Math.floor((lo + hi) / data.halves); if (compare(r, best[mid]) >= 0) lo = mid + 1; else hi = mid; }
      if (lo < limit) { best.splice(lo, 0, r); if (best.length > limit) best.pop(); }
    }
    return best;
  };
  const order = (a: any, b: any) => a.seq - b.seq || a.position - b.position;
  if (data.section === 'emoji') {
    const counts = new Map<string, any>(); let custom = 0, unicode = 0;
    for (const r of rows) if (r.kind === 'emoji') {
      const p = JSON.parse(r.payload), old = counts.get(r.term);
      if (p.id === null) unicode += r.n; else custom += r.n;
      counts.set(r.term, { ...(old && order(old, r) <= 0 ? old : { ...p, seq: r.seq, position: r.position }), count: (old?.count ?? 0) + r.n });
    }
    let unicodeMatcher = 'Extended_Pictographic';
    try { new RegExp('\\p{RGI_Emoji}', 'gv'); unicodeMatcher = 'RGI_Emoji'; } catch {}
    const emoji = [...counts.values()].sort((a, b) => b.count - a.count || (a.id ?? a.name).localeCompare(b.id ?? b.name) || order(a, b))
      .slice(0, data.top).map(({ seq: _seq, position: _pos, ...p }) => p);
    return finish([{ textMessages, custom, unicode, unicodeMatcher, emoji }]);
  }
  const stop = new Set(data.stopWords);
  const eligible = (word: string) => Array.from(word).length >= data.minWordLength && !stop.has(word);
  const frequencies = new Map<number, number>(), people = new Map<string, any>(), counts = new Map<string, any>();
  const distribution = data.lengthBuckets.map((b: any) => ({ id: b.id, count: 0 }));
  const longest: any[] = [];
  const periods = new Map<string, any>();
  let totalWords = 0, earlierWords = 0, laterWords = 0, zeroWordMessages = 0;
  for (const r of rows) {
    if (r.kind === 'length') {
      const n = Number(r.term), p = r.payload, words = n * r.n;
      totalWords += words;
      frequencies.set(n, (frequencies.get(n) ?? 0) + r.n);
      if (n === 0) zeroWordMessages += r.n; else distribution[data.lengthBuckets.findIndex((b: any) => b.max === null || n <= b.max)].count += r.n;
      const person = people.get(r.author_id) ?? { words: 0, textMessages: 0 };
      person.words += words; person.textMessages += r.n; people.set(r.author_id, person);

      const start = bucketName(r.date), period = periods.get(start) ?? { start, totalWords: 0, words: new Map() };
      period.totalWords += words; periods.set(start, period);
      if (r.first_ts < midpoint!) earlierWords += words; else laterWords += words;
    } else if (r.kind === 'longest') { for (const candidate of JSON.parse(r.payload)) longest.push(candidate); }
    else if (r.kind === 'words') for (const [word, n, seq, position] of r.tokens) {
      const old = counts.get(word);
      const c = old ?? { word, count: 0, earlier: 0, later: 0, seq, position };
      c.count += n;
      if (r.first_ts < midpoint!) c.earlier += n; else c.later += n;
      if (order({ seq, position }, c) < 0) { c.seq = seq; c.position = position; }
      counts.set(word, c);
    }
  }
  const ranked = [...counts.values()].filter((r) => eligible(r.word));
  const words = top(ranked, data.cloudWords, (a, b) => b.count - a.count || a.word.localeCompare(b.word) || order(a, b)).map(({ word, count }) => ({ word, count }));
  const changes = ranked.filter((r) => r.count >= data.trendMinUses).map((r) => ({ ...r,
    earlierRate: earlierWords ? r.earlier * data.rateScale / earlierWords : 0, laterRate: laterWords ? r.later * data.rateScale / laterWords : 0 }));
  // ICU can collate distinct spellings equally; legacy trend ties follow timestamp-group ingestion order.
  const lexical = [...changes].sort((a, b) => a.word.localeCompare(b.word));
  const tied = new Set<string>();
  for (let i = 1; i < lexical.length; i++) if (lexical[i - 1].word.localeCompare(lexical[i].word) === 0) {
    tied.add(lexical[i - 1].word); tied.add(lexical[i].word);
  }
  const trendOrders = tied.size ? new Map<string, number[]>(JSON.parse((await fold(null, read, signal,
    { ...data.config, sql: data.sql, params: data.params, mode: 'order', orderWords: [...tied], midpoint }))[0].payload)) : new Map<string, number[]>();
  const trendOrder = (a: any, b: any) => {
    const x = trendOrders.get(a.word), y = trendOrders.get(b.word);
    if (x && y) for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return order(a, b);
  };
  const delta = (r: any) => r.laterRate - r.earlierRate;
  const change = ({ word, earlierRate, laterRate }: any) => ({ word, earlierRate, laterRate });
  const rising = top(changes.filter((r) => delta(r) > 0), data.trendTop, (a, b) => delta(b) - delta(a) || a.word.localeCompare(b.word) || trendOrder(a, b)).map(change);
  const fading = top(changes.filter((r) => delta(r) < 0), data.trendTop, (a, b) => delta(a) - delta(b) || a.word.localeCompare(b.word) || trendOrder(a, b)).map(change);
  const choices = [...new Set([...words.slice(0, data.trendTop).map((r) => r.word), ...rising.map((r) => r.word), ...fading.map((r) => r.word)])];
  const chosen = new Set(choices);
  for (const r of rows) if (r.kind === 'words') for (const [word, n] of r.tokens) if (chosen.has(word)) {
    const p = periods.get(bucketName(r.date)); p.words.set(word, (p.words.get(word) ?? 0) + n);
  }
  const buckets = fill(periods, (start) => ({ start, totalWords: 0, words: new Map() })).map((p) => ({ start: p.start, totalWords: p.totalWords,
    counts: Object.fromEntries(choices.map((word) => [word, p.words.get(word) ?? 0])) }));
  const length = { medianWords: median(frequencies, textMessages), zeroWordMessages, distribution,
    longest: top(longest, data.top, (a, b) => b.words - a.words || a.ts - b.ts || a.messageId.localeCompare(b.messageId)).map((p) => ({ ...identity.get(p.userId), ...p })),
    people: [...people].filter(([, p]) => p.textMessages >= data.personMinMessages).map(([userId, p]) => ({ ...identity.get(userId), textMessages: p.textMessages, averageWords: p.words / p.textMessages }))
      .sort((a, b) => b.averageWords - a.averageWords || a.userId.localeCompare(b.userId)).slice(0, data.top) };
  return finish([{ textMessages, totalWords, uniqueWords: counts.size, wordsPerMessage: textMessages ? totalWords / textMessages : 0, words, length,
    trends: { midpointTs: midpoint, earlierWords, laterWords, rising, fading, choices, bucket, buckets } }]);
}
