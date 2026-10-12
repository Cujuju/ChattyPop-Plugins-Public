import type { PluginDb } from '@plugin-sdk/core';
import { CONVERSATION_GAP_MS, CONVERSATION_PAIRS, type ConversationPerson, type ConversationStats } from '../shared/conversations';
import type { ActivityQuery } from '../shared/types';
import { conversationMessages, type ConversationMessage } from './conversationScan';
import { scopeSql } from './stats';

interface PairCount { firstId: string; secondId: string; exchanges: number }

export async function conversationStats(db: PluginDb, query: ActivityQuery): Promise<ConversationStats> {
  const pairs = new Map<string, PairCount>();
  const exchangesByPerson = new Map<string, number>();
  let previous: ConversationMessage | undefined;
  let runHasExchange = false;
  let messages = 0;
  let conversations = 0;
  let pairedConversations = 0;

  for await (const message of conversationMessages(db, query)) {
    if (!previous || message.channel_id !== previous.channel_id || message.ts - previous.ts > CONVERSATION_GAP_MS) {
      conversations++;
      runHasExchange = false;
    } else if (message.author_id !== previous.author_id) {
      if (!runHasExchange) pairedConversations++;
      runHasExchange = true;
      const firstId = previous.author_id < message.author_id ? previous.author_id : message.author_id;
      const secondId = previous.author_id < message.author_id ? message.author_id : previous.author_id;
      const key = JSON.stringify([firstId, secondId]);
      const pair = pairs.get(key) ?? { firstId, secondId, exchanges: 0 };
      pair.exchanges++;
      pairs.set(key, pair);
      exchangesByPerson.set(firstId, (exchangesByPerson.get(firstId) ?? 0) + 1);
      exchangesByPerson.set(secondId, (exchangesByPerson.get(secondId) ?? 0) + 1);
    }
    previous = message;
    messages++;
  }
  const ranked = [...pairs.values()].sort((a, b) => b.exchanges - a.exchanges || a.firstId.localeCompare(b.firstId) || a.secondId.localeCompare(b.secondId)).slice(0, CONVERSATION_PAIRS);
  const ids = [...new Set(ranked.flatMap((pair) => [pair.firstId, pair.secondId]))];
  if (!ids.length) return { query, messages, conversations, pairedConversations, pairs: [], people: [] };
  const scope = scopeSql(db, query);
  const identities = db.prepare(`SELECT m.author_id AS userId, MIN(m.author_plain_name) AS name, u.avatar AS avatar
    FROM archive_messages m LEFT JOIN archive_users u ON u.id = m.author_id
    WHERE ${scope.sql} AND m.author_id IN (${ids.map(() => '?').join(', ')}) GROUP BY m.author_id`)
    .all(...scope.params, ...ids) as Omit<ConversationPerson, 'exchanges'>[];
  const known = new Map(identities.map((person) => [person.userId, { ...person, exchanges: exchangesByPerson.get(person.userId) ?? 0 }]));
  return {
    query, messages, conversations, pairedConversations,
    pairs: ranked.filter((pair) => known.has(pair.firstId) && known.has(pair.secondId))
      .map((pair) => ({ first: known.get(pair.firstId)!, second: known.get(pair.secondId)!, exchanges: pair.exchanges })),
    people: [...known.values()].sort((a, b) => b.exchanges - a.exchanges || a.userId.localeCompare(b.userId)),
  };
}
