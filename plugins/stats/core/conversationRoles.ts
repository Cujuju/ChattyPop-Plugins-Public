import { REPLY_MIN_RUNS } from '../shared/conversations';
import { STATS_TOP } from '../shared/types';
import { median } from './median';

/** Called only when the existing run scanner completes a run with a different-author reply. */
export function createConversationRoles() {
  const starts = new Map<string, number>();
  const closes = new Map<string, number>();
  const delays = new Map<string, Map<number, number>>();
  const allDelays = new Map<number, number>();
  let runs = 0;
  const ranking = (counts: Map<string, number>) => [...counts].map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId)).slice(0, STATS_TOP);
  return {
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
        starts: ranking(starts), closes: ranking(closes), medianReplyMs: runs ? median(allDelays, runs) : null,
        fastest: [...delays].filter(([userId]) => starts.get(userId)! >= REPLY_MIN_RUNS)
          .map(([userId, values]) => ({ userId, count: starts.get(userId)!, medianReplyMs: median(values, starts.get(userId)!) }))
          .sort((a, b) => a.medianReplyMs - b.medianReplyMs || a.userId.localeCompare(b.userId)).slice(0, STATS_TOP),
      };
    },
  };
}
