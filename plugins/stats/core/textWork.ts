import type { ArchiveRead, RollupPartition } from '@plugin-sdk/core';

export interface TextRow {
  channel_id?: string; day?: string; author_id: string; date: string; kind: string; term: string;
  n: number; first_ts: number; last_ts: number; seq: number; position: number; payload: string;
}
export interface TextData { bounds?: boolean; boundaryChannels?: string[]; timeZone?: string; mode?: 'residual' | 'boundary' | 'order'; orderWords?: string[]; midpoint?: number; startTs?: number; endTs?: number; afinn: Record<string, number>; top: number; cuts?: number[]; sql?: string; params?: (string | number)[] }

/** Closure-free lexical fold shared by durable partitions and privacy-visible boundary fragments. */
export async function textWork(part: RollupPartition | null, read: ArchiveRead, signal: AbortSignal, data: TextData): Promise<Omit<TextRow, 'channel_id' | 'day'>[]> {

  const where = part ? 'm.channel_id = ? AND m.ts >= ? AND m.ts < ?' : data.sql!;
  const params = part ? [part.channelId, part.startTs, part.endTs] : data.params!;
  const columns = `m.id, m.channel_id, m.author_id, m.author_plain_name AS name, m.ts, m.seq, m.content`;
  const rows = await read<any>(part ? `SELECT ${columns} FROM archive_all_rollup_messages m WHERE ${where}`
    : data.mode === 'residual' ? `SELECT ${columns} FROM archive_residual_messages m WHERE ${where}`
    : data.mode === 'boundary' ? `SELECT ${columns} FROM json_each(?) c CROSS JOIN archive_rollup_messages m ON m.channel_id = c.value WHERE ${where} AND m.ts >= ? AND m.ts < ?`
    : `SELECT ${columns} FROM archive_messages m WHERE ${where}`, data.mode === 'boundary' ? [JSON.stringify(data.boundaryChannels), ...params, data.startTs!, data.endTs!] : params);
  if (data.bounds) {
    let first = Infinity, last = -Infinity;
    for (const m of rows) if (m.content.trim()) { first = Math.min(first, m.ts); last = Math.max(last, m.ts); }
    return first === Infinity ? [] : [{ kind: 'lengths', first_ts: first, last_ts: last, payload: '[]' } as any];
  }
  const calendar = new Intl.DateTimeFormat('sv-SE', { timeZone: part?.timeZone ?? data.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const m of rows) m.date = calendar.format(m.ts);
  const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
  const custom = /<(a?):([a-zA-Z0-9_]+):(\d+)>/g;
  let unicode: RegExp;
  try { unicode = new RegExp('\\p{RGI_Emoji}', 'gv'); }
  catch { unicode = /(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*)/gu; }
  const wordsOf = (content: string): string[] => {
    const prose = content.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/\[[^\]\r\n]*\]\((?:<[^>\r\n]*>|(?:[^()\r\n]|\([^()\r\n]*\))*)\)/g, ' ')
      .replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/giu, ' ').replace(/<(?:@!?|@&|#)\d+>/g, ' ').replace(custom, ' ').replace(/[\u2018\u2019]/g, "'");
    const words: string[] = [];
    for (const segment of segmenter.segment(prose)) if (segment.isWordLike) words.push(segment.segment.toLowerCase());
    return words;
  };
  if (data.mode === 'order') {
    const times = new Map<number, number>(), orders = new Map<string, number[]>(), wanted = new Set(data.orderWords);
    for (const m of rows) if (m.content.trim()) times.set(m.ts, Math.min(times.get(m.ts) ?? m.seq, m.seq));
    const compare = (a: number[], b: number[]) => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
      return 0;
    };
    for (const m of rows) {
      signal.throwIfAborted();
      if (![...wanted].some((word) => m.content.toLowerCase().includes(word))) continue;
      const words = wordsOf(m.content);
      words.forEach((word, position) => {
        if (!wanted.has(word)) return;
        const order = [Number(m.ts >= data.midpoint!), times.get(m.ts)!, m.seq, position];
        if (!orders.has(word) || compare(order, orders.get(word)!) < 0) orders.set(word, order);
      });
    }
    return [{ payload: JSON.stringify([...orders]) } as any];
  }
  const groups = new Map<string, any>();
  const add = (m: any, kind: string, term: string, position = 0, payload: any = {}) => {
    const segment = (data.cuts ?? []).filter((ts) => m.ts >= ts).length;
    const key = JSON.stringify([m.channel_id, m.author_id, m.date, kind, term, segment]);
    let row = groups.get(key);
    if (!row) {
      row = { channel_id: m.channel_id, author_id: m.author_id, date: m.date, kind, term, n: 0, first_ts: m.ts, last_ts: m.ts,
        seq: m.seq, position, payload }; groups.set(key, row);
    }
    row.n++; row.first_ts = Math.min(row.first_ts, m.ts); row.last_ts = Math.max(row.last_ts, m.ts);
    if (m.seq < row.seq || (m.seq === row.seq && position < row.position)) { row.seq = m.seq; row.position = position; if (kind === 'emoji') row.payload = payload; }
    return row;
  };
  for (const m of rows) {
    signal.throwIfAborted();
    const extent = add(m, 'extent', '', 0, { name: m.name });
    if (m.name < extent.payload.name) extent.payload.name = m.name;
    if (!m.content.trim()) continue;
    const words = wordsOf(m.content);
    const length = add(m, 'length', String(words.length), 0, { positive: 0, negative: 0, longest: [] });
    const score = words.reduce((sum, word) => sum + (Object.hasOwn(data.afinn, word) ? data.afinn[word]! : 0), 0);
    if (score > 0) length.payload.positive++; else if (score < 0) length.payload.negative++;
    length.payload.longest.push({ messageId: m.id, channelId: m.channel_id, userId: m.author_id, ts: m.ts, words: words.length });
    length.payload.longest.sort((a: any, b: any) => b.words - a.words || a.ts - b.ts || a.messageId.localeCompare(b.messageId));
    length.payload.longest.length = Math.min(length.payload.longest.length, data.top);
    for (let position = 0; position < words.length; position++) add(m, 'word', words[position]!, position);
    let position = 0;
    for (const match of m.content.matchAll(custom)) add(m, 'emoji', 'custom:' + match[3], position++, { id: match[3], name: match[2], animated: match[1] === 'a' });
    for (const match of m.content.replace(custom, ' ').matchAll(unicode)) add(m, 'emoji', 'unicode:' + match[0], position++, { id: null, name: match[0], animated: false });
  }
  const packed = new Map<string, any>();
  for (const row of groups.values()) {
    const kind = row.kind === 'word' ? 'words' : row.kind === 'length' ? 'lengths' : row.kind;
    const key = JSON.stringify([row.channel_id, row.author_id, row.date, kind, (data.cuts ?? []).filter((ts) => row.first_ts >= ts).length, kind === 'words' || kind === 'lengths' ? '' : row.term]);
    let pack = packed.get(key);
    if (!pack) { pack = { ...row, kind, term: kind === 'words' || kind === 'lengths' ? '' : row.term, payload: kind === 'words' || kind === 'lengths' ? [] : row.payload }; packed.set(key, pack); }
    pack.first_ts = Math.min(pack.first_ts, row.first_ts); pack.last_ts = Math.max(pack.last_ts, row.last_ts);
    if (kind === 'words') pack.payload.push([row.term, row.n, row.seq, row.position]);
    if (kind === 'lengths') pack.payload.push([Number(row.term), row.n, row.payload.positive, row.payload.negative]);
    if (row.kind === 'length') {
      const topKey = key + '/longest';
      let top = packed.get(topKey);
      if (!top) { top = { ...row, kind: 'longest', term: '', payload: [] }; packed.set(topKey, top); }
      for (const candidate of row.payload.longest) top.payload.push(candidate);
      top.payload.sort((a: any, b: any) => b.words - a.words || a.ts - b.ts || a.messageId.localeCompare(b.messageId));
      top.payload.length = Math.min(top.payload.length, data.top);
    }
  }
  return [...packed.values()].map(({ channel_id, ...row }) => ({ ...(part ? {} : { channel_id }), ...row, payload: JSON.stringify(row.payload) }));
}
