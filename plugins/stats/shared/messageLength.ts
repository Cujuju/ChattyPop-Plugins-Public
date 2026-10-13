/** Ten text messages reduce single-message outliers in per-person averages. */
export const WORDS_PERSON_MIN_MESSAGES = 10;
/** These ranges separate short replies, sentences, paragraphs and longer posts. */
export const MESSAGE_WORD_BUCKETS = [
  { id: 'one', label: '1 word', max: 1 },
  { id: 'short', label: '2 to 5 words', max: 5 },
  { id: 'sentence', label: '6 to 20 words', max: 20 },
  { id: 'paragraph', label: '21 to 50 words', max: 50 },
  { id: 'long', label: 'Over 50 words', max: null },
] as const;

export interface LongMessage {
  messageId: string;
  channelId: string;
  userId: string;
  ts: number;
  words: number;
}

export interface WordsPerson {
  userId: string;
  textMessages: number;
  averageWords: number;
}

export interface MessageLengthStats {
  medianWords: number;
  zeroWordMessages: number;
  distribution: { id: typeof MESSAGE_WORD_BUCKETS[number]['id']; count: number }[];
  longest: LongMessage[];
  people: WordsPerson[];
}
