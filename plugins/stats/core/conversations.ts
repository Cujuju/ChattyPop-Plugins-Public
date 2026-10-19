import type { ArchiveRead } from '@plugin-sdk/core';
import { CONVERSATION_GAP_MS, CONVERSATION_PAIRS, type ConversationStats } from '../shared/conversations';
import { everyoneQuery, type ActivityQuery } from '../shared/types';
import { conversationMessages, type ConversationMessage } from './conversationScan';
import { readPosterIdentities, scopeSql } from './stats';
import { createConversationRoles } from './conversationRoles';

interface PairCount { firstId: string; secondId: string; exchanges: number }

export async function conversationStats(read: ArchiveRead, query: ActivityQuery): Promise<ConversationStats> {
  const pairs = new Map<string, PairCount>();
  const exchangesByPerson = new Map<string, number>();
  let previous: ConversationMessage | undefined;
  let runHasExchange = false;
  let runHasPerson = false;
  let messages = 0;
  let conversations = 0;
  let pairedConversations = 0;
  const roles = createConversationRoles(query.authorId);
  let opener: ConversationMessage | undefined;
  let firstReplyMs: number | null = null;
  const finishRun = () => {
    if (opener && previous && firstReplyMs !== null) roles.read(opener.author_id, previous.author_id, firstReplyMs);
    if (opener && (query.authorId == null || runHasPerson)) {
      conversations++;
      if (runHasExchange) pairedConversations++;
    }
  };

  const scopeQuery = everyoneQuery(query);
  for await (const message of conversationMessages(read, scopeQuery)) {
    roles.observe(message.author_id);
    if (!previous || message.channel_id !== previous.channel_id || message.ts - previous.ts > CONVERSATION_GAP_MS) {
      finishRun();
      opener = message;
      firstReplyMs = null;
      runHasExchange = false;
      runHasPerson = false;
    } else if (message.author_id !== previous.author_id) {
      if (!runHasExchange) {
        firstReplyMs = message.ts - opener!.ts;
      }
      runHasExchange = true;
      if (query.authorId == null || previous.author_id === query.authorId || message.author_id === query.authorId) {
        const firstId = previous.author_id < message.author_id ? previous.author_id : message.author_id;
        const secondId = previous.author_id < message.author_id ? message.author_id : previous.author_id;
        const key = JSON.stringify([firstId, secondId]);
        const pair = pairs.get(key) ?? { firstId, secondId, exchanges: 0 };
        pair.exchanges++;
        pairs.set(key, pair);
        exchangesByPerson.set(firstId, (exchangesByPerson.get(firstId) ?? 0) + 1);
        exchangesByPerson.set(secondId, (exchangesByPerson.get(secondId) ?? 0) + 1);
      }
    }
    if (message.author_id === query.authorId) runHasPerson = true;
    previous = message;
    if (query.authorId == null || message.author_id === query.authorId) messages++;
  }
  finishRun();
  const roleCounts = roles.finish();
  const ranked = [...pairs.values()].sort((a, b) => b.exchanges - a.exchanges || a.firstId.localeCompare(b.firstId) || a.secondId.localeCompare(b.secondId)).slice(0, CONVERSATION_PAIRS);
  const graphIds = [...new Set(ranked.flatMap((pair) => [pair.firstId, pair.secondId]))];
  const ids = [...new Set([...graphIds, ...roleCounts.starts.map((p) => p.userId), ...roleCounts.closes.map((p) => p.userId), ...roleCounts.fastest.map((p) => p.userId)])];
  if (!ids.length) return { query, messages, conversations, pairedConversations, pairs: [], people: [], roles: {
    starts: [], closes: [], fastest: [], medianReplyMs: roleCounts.medianReplyMs,
    ...(roleCounts.person ? { person: roleCounts.person } : {}),
  } };
  const scope = (await scopeSql(read, scopeQuery));
  const identities = (await readPosterIdentities(read, scope, ids));
  const known = new Map(identities.map((person) => [person.userId, { ...person, exchanges: exchangesByPerson.get(person.userId) ?? 0 }]));
  const identity = (userId: string) => {
    const { exchanges: _exchanges, ...person } = known.get(userId)!;
    return person;
  };
  return {
    query, messages, conversations, pairedConversations,
    pairs: ranked.filter((pair) => known.has(pair.firstId) && known.has(pair.secondId))
      .map((pair) => ({ first: known.get(pair.firstId)!, second: known.get(pair.secondId)!, exchanges: pair.exchanges })),
    people: graphIds.filter((id) => known.has(id)).map((id) => known.get(id)!).sort((a, b) => b.exchanges - a.exchanges || a.userId.localeCompare(b.userId)),
    roles: {
      starts: roleCounts.starts.filter((p) => known.has(p.userId)).map((p) => ({ ...identity(p.userId), count: p.count })),
      closes: roleCounts.closes.filter((p) => known.has(p.userId)).map((p) => ({ ...identity(p.userId), count: p.count })),
      fastest: roleCounts.fastest.filter((p) => known.has(p.userId)).map((p) => ({ ...identity(p.userId), ...p })),
      medianReplyMs: roleCounts.medianReplyMs,
      ...(roleCounts.person ? { person: roleCounts.person } : {}),
    },
  };
}
