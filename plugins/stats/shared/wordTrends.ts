import type { ActivityStats } from './types';

/** Five uses suppress single-mention changes while keeping small archives useful. */
export const WORD_TREND_MIN_USES = 5;
/** Ten entries bound each ranking and the initial top-word choices. */
export const WORD_TREND_TOP = 10;
/** Per-thousand rates compare vocabulary independently of how much text each period contains. */
export const WORD_RATE_BASE = 1000;

export interface WordChange { word: string; earlierRate: number; laterRate: number }
export interface WordTrendBucket { start: string; totalWords: number; counts: Record<string, number> }
export interface WordTrends {
  midpointTs: number | null;
  earlierWords: number;
  laterWords: number;
  rising: WordChange[];
  fading: WordChange[];
  choices: string[];
  bucket: ActivityStats['bucket'];
  buckets: WordTrendBucket[];
}

export const wordRate = (uses: number, totalWords: number): number => totalWords ? uses * WORD_RATE_BASE / totalWords : 0;
export const wordStrip = (buckets: readonly WordTrendBucket[], word: string): number[] => buckets.map((bucket) => wordRate(bucket.counts[word] ?? 0, bucket.totalWords));
