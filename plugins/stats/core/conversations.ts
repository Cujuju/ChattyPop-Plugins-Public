import type { PluginDb } from '@plugin-sdk/core';
import { CONVERSATION_GAP_MS, CONVERSATION_PAIRS, type ConversationStats } from '../shared/conversations';
import type { ActivityQuery, StatsPoster } from '../shared/types';
import { conversationMessages } from './conversationScan';
import { SCAN_BATCH_SIZE, yieldToQueue } from './scan';
import { scopeSql } from './stats';

interface PairCount { firstId: string; secondId: string; count: number }

export async function conversationStats(db: PluginDb, query: ActivityQuery): Promise<ConversationStats> {
  const pairs = new Map<string, PairCount>();
  const ties = new Map<string, number>();
  let people = new Set<string>();
  let channel: string | undefined;
  let lastTs = 0;
  let messages = 0;
  let conversations = 0;
  let pairedConversations = 0;

  const finish = async (): Promise<void> => {
    if (!people.size) return;
    conversations++;
    if (people.size < 2) return;
    pairedConversations++;
    const ids = [...people].sort();
    let counted = 0;
    for (const [index, firstId] of ids.entries()) {
      ties.set(firstId, (ties.get(firstId) ?? 0) + ids.length - 1);
      for (let partner = index + 1; partner < ids.length; partner++) {
        const secondId = ids[partner]!;
        const key = JSON.stringify([firstId, secondId]);
        const pair = pairs.get(key) ?? { firstId, secondId, count: 0 };
        pair.count++;
        pairs.set(key, pair);
        // Pair batches bound the work of unusually large conversations as message batches bound reads.
        if (++counted % SCAN_BATCH_SIZE === 0) await yieldToQueue();
      }
    }
  };

  for await (const message of conversationMessages(db, query)) {
    if (message.channel_id !== channel || message.ts - lastTs > CONVERSATION_GAP_MS) {
      await finish();
      people = new Set();
    }
    people.add(message.author_id);
    channel = message.channel_id;
    lastTs = message.ts;
    messages++;
  }
  await finish();
  const ranked = [...pairs.values()].sort((a, b) => b.count - a.count || a.firstId.localeCompare(b.firstId) || a.secondId.localeCompare(b.secondId)).slice(0, CONVERSATION_PAIRS);
  const ids = [...new Set(ranked.flatMap((pair) => [pair.firstId, pair.secondId]))];
  if (!ids.length) return { query, messages, conversations, pairedConversations, pairs: [], people: [] };
  const scope = scopeSql(db, query);
  const identities = db.prepare(`SELECT m.author_id AS userId, MIN(m.author_plain_name) AS name, u.avatar AS avatar
    FROM archive_messages m LEFT JOIN archive_users u ON u.id = m.author_id
    WHERE ${scope.sql} AND m.author_id IN (${ids.map(() => '?').join(', ')}) GROUP BY m.author_id`)
    .all(...scope.params, ...ids) as Omit<StatsPoster, 'count'>[];
  const known = new Map(identities.map((person) => [person.userId, { ...person, count: ties.get(person.userId) ?? 0 }]));
  return {
    query, messages, conversations, pairedConversations,
    pairs: ranked.filter((pair) => known.has(pair.firstId) && known.has(pair.secondId))
      .map((pair) => ({ first: known.get(pair.firstId)!, second: known.get(pair.secondId)!, count: pair.count })),
    people: [...known.values()].sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId)),
  };
}
