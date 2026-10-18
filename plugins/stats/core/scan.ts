import type { ArchiveRead, PluginDb } from '@plugin-sdk/core';
import type { TextQuery } from './query';
import { scanBatches } from './scanBatches';
export { SCAN_BATCH_SIZE, yieldToQueue } from './scanQueue';

export interface TextMessage {
  id: string;
  content: string;
  author_id: string;
  channel_id: string;
  ts: number;
  seq: number;
}

/** A sequence ceiling excludes messages arriving during the scan; every batch rechecks archive visibility. */
export async function scanText(db: PluginDb, query: TextQuery, read: (message: TextMessage) => void, signal?: AbortSignal, aggregate?: ArchiveRead): Promise<number> {
  let textMessages = 0;
  for await (const rows of scanBatches<TextMessage>(db, query, 'm.id, m.content, m.author_id, m.channel_id, m.ts, m.seq', signal, aggregate)) {
    for (const message of rows) {
      if (!message.content.trim()) continue;
      read(message);
      textMessages++;
    }
  }
  return textMessages;
}
