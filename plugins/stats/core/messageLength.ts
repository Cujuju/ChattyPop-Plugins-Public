import { MESSAGE_WORD_BUCKETS, WORDS_PERSON_MIN_MESSAGES, type LongMessage } from '../shared/messageLength';
import { STATS_TOP } from '../shared/types';
import type { TextMessage } from './scan';
import { median } from './median';

/** Frequencies and a bounded ranking accumulate during the section's existing text scan. */
export function createMessageLengths() {
  const frequencies = new Map<number, number>();
  const people = new Map<string, { words: number; messages: number }>();
  const longest: Omit<LongMessage, 'name' | 'avatar'>[] = [];
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
    finish(textMessages: number) {
      return {
        medianWords: median(frequencies, textMessages), zeroWordMessages, distribution, longest,
        people: [...people].filter(([, person]) => person.messages >= WORDS_PERSON_MIN_MESSAGES)
          .map(([userId, person]) => ({ userId, textMessages: person.messages, averageWords: person.words / person.messages }))
          .sort((a, b) => b.averageWords - a.averageWords || a.userId.localeCompare(b.userId)).slice(0, STATS_TOP),
      };
    },
  };
}
