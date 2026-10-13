import type { PluginDb } from '@plugin-sdk/core';
import { en } from 'stopwords-iso/stopwords-iso.json';
import type { ActivityQuery } from '../shared/types';
import { CLOUD_WORDS, MIN_WORD_LENGTH, type WordStats } from '../shared/text';
import { scanText } from './scan';
import { tokenize } from './tokenize';
import { createMessageLengths } from './messageLength';

const STOP_WORDS = new Set(en);

export async function wordStats(db: PluginDb, query: ActivityQuery): Promise<WordStats> {
  const counts = new Map<string, number>();
  const lengths = createMessageLengths();
  let totalWords = 0;
  const textMessages = await scanText(db, query, (message) => {
    const tokens = tokenize(message.content);
    lengths.read(message, tokens.length);
    for (const word of tokens) {
      totalWords++;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  });
  const words = [...counts].filter(([word]) => Array.from(word).length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word))
    .map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, CLOUD_WORDS);
  return { textMessages, totalWords, uniqueWords: counts.size, wordsPerMessage: textMessages ? totalWords / textMessages : 0,
    words, length: lengths.finish(textMessages) };
}
