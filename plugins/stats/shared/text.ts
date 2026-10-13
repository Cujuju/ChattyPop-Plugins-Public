import type { MessageLengthStats } from './messageLength';
import type { WordTrends } from './wordTrends';

export interface TextCoverage {
  /** Visible messages with nonempty retained content read by this call. */
  textMessages: number;
}

export interface EmojiCount {
  id: string | null;
  name: string;
  animated: boolean;
  count: number;
}

export interface EmojiStats extends TextCoverage {
  custom: number;
  unicode: number;
  unicodeMatcher: 'RGI_Emoji' | 'Extended_Pictographic';
  emoji: EmojiCount[];
}

/** Three-character words exclude short fragments; sixty entries fill a readable cloud. */
export const MIN_WORD_LENGTH = 3;
export const CLOUD_WORDS = 60;
/** Twenty ranked entries keep the accessible list short enough to scan. */
export const RANKED_WORDS = 20;

export interface WordCount {
  word: string;
  count: number;
}

export interface WordStats extends TextCoverage {
  totalWords: number;
  uniqueWords: number;
  wordsPerMessage: number;
  words: WordCount[];
  length: MessageLengthStats;
  trends: WordTrends;
}

export const SENTIMENT_CLASSES = ['positive', 'negative', 'neutral'] as const;
export type SentimentClass = typeof SENTIMENT_CLASSES[number];
/** Fifty text messages limit each message's influence to two percentage points, suppressing near-empty bucket noise. */
export const SENTIMENT_MIN_SAMPLE = 50;

export interface SentimentStats extends TextCoverage {
  classes: Record<SentimentClass, number>;
  bucket: 'day' | 'week';
  buckets: { start: string; positive: number; negative: number; messages: number }[];
}

/** Unrated buckets never set the scale; rated zero shares stay zero even when the entire strip is zero. */
export function sentimentFractions(buckets: readonly SentimentStats['buckets'][number][], key: 'positive' | 'negative'): (number | 'unrated')[] {
  const shares = buckets.map((bucket) => bucket.messages < SENTIMENT_MIN_SAMPLE ? 'unrated' as const : bucket[key] / bucket.messages);
  const max = shares.reduce<number>((highest, value) => value === 'unrated' ? highest : Math.max(highest, value), 0);
  return shares.map((value) => value === 'unrated' ? value : max ? value / max : 0);
}
