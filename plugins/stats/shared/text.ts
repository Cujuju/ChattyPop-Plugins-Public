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
export interface SentimentBucket {
  start: string;
  positive: number;
  negative: number;
  messages: number;
}

export interface SentimentStats extends TextCoverage {
  classes: Record<SentimentClass, number>;
  bucket: 'day' | 'week';
  buckets: SentimentBucket[];
}

/** Positive and negative bars share one scale, the longest bar either way, so their lengths compare across the baseline. */
export const sentimentScale = (buckets: readonly SentimentBucket[]): number =>
  buckets.reduce((longest, bucket) => Math.max(longest, bucket.positive, bucket.negative), 0);

/** The share of a bar its opposite doesn't cancel: the bucket's balance. Zero for the shorter bar and for a tie. */
export const uncancelledShare = (count: number, opposite: number): number => count > opposite ? (count - opposite) / count : 0;
