import type { PluginDb } from '@plugin-sdk/core';
import type { ActivityQuery } from '../shared/types';
import { SCAN_BATCH_SIZE, yieldToQueue } from './scan';
import { scopeSql } from './stats';

export interface ConversationMessage {
  channel_id: string;
  ts: number;
  author_id: string;
  seq: number;
}

/** Keyset pages preserve channel/time order, including equal timestamps, without selecting retained text. */
export async function* conversationMessages(db: PluginDb, query: ActivityQuery): AsyncGenerator<ConversationMessage> {
  const scope = scopeSql(db, query);
  const ceiling = db.prepare(`SELECT MAX(m.seq) FROM archive_messages m WHERE ${scope.sql}`).pluck().get(...scope.params) as number | null;
  if (ceiling === null) return;
  const base = `SELECT m.channel_id, m.ts, m.author_id, m.seq FROM archive_messages m WHERE ${scope.sql} AND m.seq <= ?`;
  const first = db.prepare(`${base} ORDER BY m.channel_id, m.ts, m.seq LIMIT ?`);
  const next = db.prepare(`${base} AND (m.channel_id, m.ts, m.seq) > (?, ?, ?) ORDER BY m.channel_id, m.ts, m.seq LIMIT ?`);
  let cursor: ConversationMessage | undefined;
  while (true) {
    const rows = (cursor
      ? next.all(...scope.params, ceiling, cursor.channel_id, cursor.ts, cursor.seq, SCAN_BATCH_SIZE)
      : first.all(...scope.params, ceiling, SCAN_BATCH_SIZE)) as ConversationMessage[];
    if (!rows.length) break;
    for (const message of rows) yield message;
    cursor = rows.at(-1)!;
    await yieldToQueue();
    if (rows.length < SCAN_BATCH_SIZE) break;
  }
}
