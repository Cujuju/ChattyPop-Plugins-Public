import { MESSAGE_WORD_BUCKETS, WORDS_PERSON_MIN_MESSAGES, type LongMessage, type MessageLengthStats } from '../shared/messageLength';
import { STATS_TOP } from '../shared/types';
import type { TextMessage } from './scan';

/** An even sample's median averages its two central observations. */
const MEDIAN_HALVES = 2;

function median(frequencies: Map<number, number>, messages: number): number {
  if (!messages) return 0;
  const lower = Math.floor((messages - 1) / MEDIAN_HALVES);
  const upper = Math.floor(messages / MEDIAN_HALVES);
  let seen = 0;
  let lowerValue = 0;
  for (const [words, count] of [...frequencies].sort(([a], [b]) => a - b)) {
    if (seen <= lower && seen + count > lower) lowerValue = words;
    if (seen + count > upper) return (lowerValue + words) / MEDIAN_HALVES;
    seen += count;
  }
  return 0;
}

/** Frequencies and a bounded ranking accumulate during the section's existing text scan. */
export function createMessageLengths() {
  const frequencies = new Map<number, number>();
  const people = new Map<string, { words: number; messages: number }>();
  const longest: LongMessage[] = [];
  const distribution = MESSAGE_WORD_BUCKETS.map(({ id }) => ({ id, count: 0 }));
  let zeroWordMessages = 0;
  return {
    read(message: TextMessage, words: number): void {
      frequencies.set(words, (frequencies.get(words) ?? 0) + 1);
      if (!words) zeroWordMessages++;
      else {
        const bucket = MESSAGE_WORD_BUCKETS.findIndex((b) => b.max === null || words <= b.max);
        distribution[bucket]!.count++;
      }
      const person = people.get(message.author_id) ?? { words: 0, messages: 0 };
      person.words += words;
      person.messages++;
      people.set(message.author_id, person);
      longest.push({ messageId: message.id, channelId: message.channel_id, userId: message.author_id, ts: message.ts, words });
      longest.sort((a, b) => b.words - a.words || a.ts - b.ts || a.messageId.localeCompare(b.messageId));
      if (longest.length > STATS_TOP) longest.pop();
    },
    finish(textMessages: number): MessageLengthStats {
      return {
        medianWords: median(frequencies, textMessages), zeroWordMessages, distribution, longest,
        people: [...people].filter(([, person]) => person.messages >= WORDS_PERSON_MIN_MESSAGES)
          .map(([userId, person]) => ({ userId, textMessages: person.messages, averageWords: person.words / person.messages }))
          .sort((a, b) => b.averageWords - a.averageWords || a.userId.localeCompare(b.userId)).slice(0, STATS_TOP),
      };
    },
  };
}
