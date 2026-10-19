import type { ArchiveRead, RollupPartition } from '@plugin-sdk/core';

export const RUN_PAGE_SIZE = 2_000; // Header-only continuation pages bound worker memory for very long runs.
export interface StoredRun { channel_id?: string; opener_id: string; first_ts: number; last_ts: number; payload: string }
export interface RunData { gapMs: number; pageSize: number; sql?: string; params?: (string | number)[] }

/** Only runs opened in this partition are stored; a continuing final run seeks forward until its first lull. */
export async function runWork(part: RollupPartition | null, read: ArchiveRead, signal: AbortSignal, data: RunData): Promise<Omit<StoredRun, 'channel_id'>[]> {
  const columns = 'm.id, m.channel_id, m.author_id, m.author_plain_name AS name, m.ts, m.seq';
  const order = 'ORDER BY m.channel_id, m.ts, m.seq';
  let messages: any[], previous: any;
  if (part) {
    messages = await read<any>(`SELECT ${columns} FROM archive_all_rollup_messages m WHERE m.channel_id = ? AND m.ts >= ? AND m.ts < ? ${order}`, [part.channelId, part.startTs, part.endTs]);
    previous = (await read<any>(`SELECT ${columns} FROM archive_all_rollup_messages m WHERE m.channel_id = ? AND m.ts < ? ORDER BY m.ts DESC, m.seq DESC LIMIT 1`, [part.channelId, part.startTs]))[0];
  } else messages = await read<any>(`SELECT ${columns} FROM archive_messages m WHERE ${data.sql} ${order}`, data.params);
  const result: StoredRun[] = [];
  let run: any;
  const finish = () => {
    if (run) result.push({ ...(part ? {} : { channel_id: run.channel_id }), opener_id: run.id, first_ts: run.ts, last_ts: run.lastTs,
      payload: JSON.stringify({ opener: run.author_id, closer: previous.author_id, replyMs: run.replyMs,
        people: [...run.people.values()], pairs: [...run.pairs.values()] }) });
    run = undefined;
  };
  const consume = (m: any) => {
    signal.throwIfAborted();
    if (!previous || previous.channel_id !== m.channel_id || m.ts - previous.ts > data.gapMs) {
      finish();
      if (!part || m.ts < part.endTs) run = { ...m, lastTs: m.ts, replyMs: null, people: new Map(), pairs: new Map() };
    }
    if (run) {
      const person = run.people.get(m.author_id) ?? { userId: m.author_id, name: m.name, count: 0 };
      person.count++; if (m.name < person.name) person.name = m.name; run.people.set(m.author_id, person);
      if (previous && previous.channel_id === m.channel_id && m.ts - previous.ts <= data.gapMs && previous.author_id !== m.author_id) {
        if (run.replyMs === null) run.replyMs = m.ts - run.ts;
        const ids = [previous.author_id, m.author_id].sort();
        const key = JSON.stringify(ids), pair = run.pairs.get(key) ?? { firstId: ids[0], secondId: ids[1], exchanges: 0 };
        pair.exchanges++; run.pairs.set(key, pair);
      }
      run.lastTs = m.ts;
    }
    previous = m;
  };
  messages.forEach(consume);
  while (part && run && previous) {
    const page = await read<any>(`SELECT ${columns} FROM archive_all_rollup_messages m WHERE m.channel_id = ? AND (m.ts, m.seq) > (?, ?) ORDER BY m.ts, m.seq LIMIT ?`,
      [part.channelId, previous.ts, previous.seq, data.pageSize]);
    if (!page.length) break;
    for (const m of page) { consume(m); if (!run) break; }
    if (!run || page.length < data.pageSize) break;
  }
  finish();
  return result;
}
