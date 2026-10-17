import type { PluginDb } from '@plugin-sdk/core';
import type { TextQuery } from './query';
import { scopeSql } from './stats';
import { SCAN_BATCH_SIZE, yieldToQueue } from './scanQueue';

interface OrderedMessage { channel_id: string; ts: number; seq: number }
interface ChannelCeiling { channelId: string; ceiling: number }

/** Separate equality and later-time branches seek the channel/time index, including its implicit sequence tie-breaker. */
export async function* scanBatches<T extends OrderedMessage>(db: PluginDb, query: TextQuery, columns: string, signal?: AbortSignal): AsyncGenerator<T[]> {
  signal?.throwIfAborted();
  const scope = scopeSql(db, query);
  const channels = db.prepare(`SELECT MAX(m.seq) AS ceiling, m.channel_id AS channelId FROM archive_messages m
    WHERE ${scope.sql} GROUP BY m.channel_id ORDER BY m.channel_id`).all(...scope.params) as ChannelCeiling[];
  signal?.throwIfAborted();
  if (!channels.length) return;
  const ceiling = channels.reduce((max, channel) => Math.max(max, channel.ceiling), channels[0]!.ceiling);
  // The channel seek is fixed; residual scope membership must not displace its channel/time index. Every page still rechecks scope and visibility.
  const base = `SELECT ${columns} FROM archive_messages m WHERE CASE WHEN ${scope.sql} THEN 1 ELSE 0 END AND m.channel_id = ? AND m.seq <= ?`;
  const first = db.prepare(`${base} ORDER BY m.ts, m.seq LIMIT ?`);
  // A tuple inequality alone seeks ts but revisits all equal-time rows on each page. Both branches here have bounded index ranges.
  const next = db.prepare(`${base} AND m.ts = ? AND m.seq > ? UNION ALL
    ${base} AND m.ts > ? ORDER BY ts, seq LIMIT ?`);
  for (const { channelId } of channels) {
    let cursor: OrderedMessage | undefined;
    while (true) {
      signal?.throwIfAborted();
      const rows = (cursor
        ? next.all(...scope.params, channelId, ceiling, cursor.ts, cursor.seq, ...scope.params, channelId, ceiling, cursor.ts, SCAN_BATCH_SIZE)
        : first.all(...scope.params, channelId, ceiling, SCAN_BATCH_SIZE)) as T[];
      signal?.throwIfAborted();
      if (!rows.length) break;
      yield rows;
      cursor = rows.at(-1)!;
      await yieldToQueue();
      signal?.throwIfAborted();
      if (rows.length < SCAN_BATCH_SIZE) break;
    }
  }
}
