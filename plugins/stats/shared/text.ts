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
}

export const SENTIMENT_CLASSES = ['positive', 'negative', 'neutral'] as const;
export type SentimentClass = typeof SENTIMENT_CLASSES[number];

export interface SentimentStats extends TextCoverage {
  classes: Record<SentimentClass, number>;
  bucket: 'day' | 'week';
  buckets: { start: string; positive: number; negative: number; messages: number }[];
}
