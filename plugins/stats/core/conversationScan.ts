import type { PluginDb } from '@plugin-sdk/core';
import type { ActivityQuery } from '../shared/types';
import { scanBatches } from './scanBatches';

export interface ConversationMessage {
  channel_id: string;
  ts: number;
  author_id: string;
  seq: number;
}

/** Keyset pages preserve channel/time order, including equal timestamps, without selecting retained text. */
export async function* conversationMessages(db: PluginDb, query: ActivityQuery): AsyncGenerator<ConversationMessage> {
  for await (const rows of scanBatches<ConversationMessage>(db, query, 'm.channel_id, m.ts, m.author_id, m.seq')) {
    for (const message of rows) yield message;
  }
}
