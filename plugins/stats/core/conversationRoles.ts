import { REPLY_MIN_RUNS } from '../shared/conversations';
import { STATS_TOP } from '../shared/types';
import { median } from './median';

/** Runs with a different-author reply contribute opener, closer and reply-delay counts. */
export function createConversationRoles(authorId?: string | null) {
  const authors = new Set<string>();
  const starts = new Map<string, number>();
  const closes = new Map<string, number>();
  const delays = new Map<string, Map<number, number>>();
  const allDelays = new Map<number, number>();
  let runs = 0;
  const ranking = (counts: Map<string, number>) => [...counts].map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId)).slice(0, STATS_TOP);
  const scopeMedian = (counts: Map<string, number>) => {
    const frequencies = new Map<number, number>();
    for (const id of authors) {
      const count = counts.get(id) ?? 0;
      frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
    }
    return median(frequencies, authors.size);
  };
  return {
    observe(userId: string) { authors.add(userId); },
    read(openerId: string, closerId: string, replyMs: number) {
      runs++;
      starts.set(openerId, (starts.get(openerId) ?? 0) + 1);
      closes.set(closerId, (closes.get(closerId) ?? 0) + 1);
      const person = delays.get(openerId) ?? new Map<number, number>();
      person.set(replyMs, (person.get(replyMs) ?? 0) + 1);
      delays.set(openerId, person);
      allDelays.set(replyMs, (allDelays.get(replyMs) ?? 0) + 1);
    },
    finish() {
      return {
        starts: authorId != null ? [] : ranking(starts), closes: authorId != null ? [] : ranking(closes), medianReplyMs: runs ? median(allDelays, runs) : null,
        ...(authorId == null ? {} : { person: {
          starts: starts.get(authorId) ?? 0, closes: closes.get(authorId) ?? 0, replyCount: starts.get(authorId) ?? 0,
          medianReplyMs: delays.has(authorId) ? median(delays.get(authorId)!, starts.get(authorId)!) : null,
          scopeMedianStarts: scopeMedian(starts), scopeMedianCloses: scopeMedian(closes),
        } }),
        fastest: authorId != null ? [] : [...delays].filter(([userId]) => starts.get(userId)! >= REPLY_MIN_RUNS)
          .map(([userId, values]) => ({ userId, count: starts.get(userId)!, medianReplyMs: median(values, starts.get(userId)!) }))
          .sort((a, b) => a.medianReplyMs - b.medianReplyMs || a.userId.localeCompare(b.userId)).slice(0, STATS_TOP),
      };
    },
  };
}
