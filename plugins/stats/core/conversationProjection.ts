import type { ArchiveRead } from '@plugin-sdk/core';
import type { ConversationStats } from '../shared/conversations';
import type { StoredRun } from './runWork';

interface PairCount { firstId: string; secondId: string; exchanges: number }

export async function conversationProjection(rows: StoredRun[], read: ArchiveRead, data: any): Promise<ConversationStats> {
  const { query, pairLimit } = data;
  const createConversationRoles = new Function(`return (${data.roles})`)();
  const roles = createConversationRoles(query.authorId, data.roleConfig);
  const pairs = new Map<string, PairCount>();
  const exchangesByPerson = new Map<string, number>();
  let messages = 0, conversations = 0, pairedConversations = 0;
  const identitiesById = new Map<string, any>();
  for (const row of rows) {
    if (query.sinceTs !== null && row.first_ts < query.sinceTs) continue;
    const run = JSON.parse(row.payload);
    for (const p of run.people) {
      roles.observe(p.userId);
      const prior = identitiesById.get(p.userId);
      if (!prior || p.name < prior.name) identitiesById.set(p.userId, { userId: p.userId, name: p.name, avatar: null });
      if (query.authorId == null || query.authorId === p.userId) messages += p.count;
    }
    if (run.replyMs !== null) roles.read(run.opener, run.closer, run.replyMs);
    if (query.authorId == null || run.people.some((p: any) => p.userId === query.authorId)) { conversations++; if (run.pairs.length) pairedConversations++; }
    for (const p of run.pairs) {
      if (query.authorId != null && p.firstId !== query.authorId && p.secondId !== query.authorId) continue;
      const key = JSON.stringify([p.firstId, p.secondId]);
      const pair = pairs.get(key) ?? { ...p, exchanges: 0 }; pair.exchanges += p.exchanges; pairs.set(key, pair);
      for (const id of [p.firstId, p.secondId]) exchangesByPerson.set(id, (exchangesByPerson.get(id) ?? 0) + p.exchanges);
    }
  }
  const roleCounts = roles.finish();
  const ranked = [...pairs.values()].sort((a, b) => b.exchanges - a.exchanges || a.firstId.localeCompare(b.firstId) || a.secondId.localeCompare(b.secondId)).slice(0, pairLimit);
  const graphIds = [...new Set(ranked.flatMap((pair) => [pair.firstId, pair.secondId]))];
  const ids = [...new Set([...graphIds, ...roleCounts.starts.map((p: any) => p.userId), ...roleCounts.closes.map((p: any) => p.userId), ...roleCounts.fastest.map((p: any) => p.userId)])];
  if (!ids.length) return { query, messages, conversations, pairedConversations, pairs: [], people: [], roles: {
    starts: [], closes: [], fastest: [], medianReplyMs: roleCounts.medianReplyMs,
    ...(roleCounts.person ? { person: roleCounts.person } : {}),
  } };
  for (const p of await read<{ id: string; avatar: string | null }>('SELECT id, avatar FROM archive_users WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(ids)])) identitiesById.get(p.id)!.avatar = p.avatar;
  const identities = ids.map((id) => identitiesById.get(id)!);
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
      starts: roleCounts.starts.filter((p: any) => known.has(p.userId)).map((p: any) => ({ ...identity(p.userId), count: p.count })),
      closes: roleCounts.closes.filter((p: any) => known.has(p.userId)).map((p: any) => ({ ...identity(p.userId), count: p.count })),
      fastest: roleCounts.fastest.filter((p: any) => known.has(p.userId)).map((p: any) => ({ ...identity(p.userId), ...p })),
      medianReplyMs: roleCounts.medianReplyMs,
      ...(roleCounts.person ? { person: roleCounts.person } : {}),
    },
  };
}
