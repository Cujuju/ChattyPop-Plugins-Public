import type { PluginDb } from '@plugin-sdk/core';
import type { ActivityQuery } from '../shared/types';
import { scopeSql } from './stats';

/** Five hundred rows bound each synchronous read before other core requests can run. */
export const SCAN_BATCH_SIZE = 500;
export const yieldToQueue = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export interface TextMessage {
  content: string;
  author_id: string;
  channel_id: string;
  ts: number;
  seq: number;
}

/** A sequence ceiling excludes messages arriving during the scan; every batch rechecks archive visibility. */
export async function scanText(db: PluginDb, query: ActivityQuery, read: (message: TextMessage) => void): Promise<number> {
  const scope = scopeSql(db, query);
  const ceiling = db.prepare(`SELECT MAX(m.seq) FROM archive_messages m WHERE ${scope.sql}`).pluck().get(...scope.params) as number | null;
  if (ceiling === null) return 0;
  const pick = db.prepare(`SELECT m.content, m.author_id, m.channel_id, m.ts, m.seq FROM archive_messages m
    WHERE ${scope.sql} AND m.seq > ? AND m.seq <= ? ORDER BY m.seq LIMIT ?`);
  let cursor = 0;
  let textMessages = 0;
  while (cursor < ceiling) {
    const rows = pick.all(...scope.params, cursor, ceiling, SCAN_BATCH_SIZE) as TextMessage[];
    if (!rows.length) break;
    for (const message of rows) {
      if (!message.content.trim()) continue;
      read(message);
      textMessages++;
    }
    cursor = rows.at(-1)!.seq;
    await yieldToQueue();
  }
  return textMessages;
}
