import { WORD_TREND_MIN_USES, WORD_TREND_TOP, wordRate, type WordChange, type WordTrends } from '../shared/wordTrends';
import type { WordCount } from '../shared/text';
import type { ActivityStats } from '../shared/types';
import { bucketStart, filledBuckets } from './histogram';

/** Timestamped counts resolve the exact text midpoint after one scan, including out-of-order ingestion; no message text is retained. */
export function createWordTrends(bucket: ActivityStats['bucket'], eligible: (word: string) => boolean) {
  const times = new Map<number, { totalWords: number; words: Map<string, number> }>();
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  return {
    read(ts: number, tokens: string[]) {
      firstTs = Math.min(firstTs ?? ts, ts);
      lastTs = Math.max(lastTs ?? ts, ts);
      const counts = times.get(ts) ?? { totalWords: 0, words: new Map<string, number>() };
      counts.totalWords += tokens.length;
      for (const word of tokens) if (eligible(word)) counts.words.set(word, (counts.words.get(word) ?? 0) + 1);
      times.set(ts, counts);
    },
    finish(words: WordCount[]): WordTrends {
      const midpointTs = firstTs === null || lastTs === null ? null : firstTs + (lastTs - firstTs) / 2;
      const earlier = new Map<string, number>();
      const later = new Map<string, number>();
      let earlierWords = 0;
      let laterWords = 0;
      const buckets = new Map<string, { totalWords: number; words: Map<string, number> }>();
      for (const [ts, counts] of times) {
        // The midpoint belongs to the later half; a zero-duration scope therefore has no earlier words.
        const half = ts < midpointTs! ? earlier : later;
        if (half === earlier) earlierWords += counts.totalWords;
        else laterWords += counts.totalWords;
        const start = bucketStart(new Date(ts), bucket);
        const period = buckets.get(start) ?? { totalWords: 0, words: new Map<string, number>() };
        period.totalWords += counts.totalWords;
        for (const [word, count] of counts.words) {
          half.set(word, (half.get(word) ?? 0) + count);
          period.words.set(word, (period.words.get(word) ?? 0) + count);
        }
        buckets.set(start, period);
      }
      const changes: WordChange[] = [...new Set([...earlier.keys(), ...later.keys()])]
        .filter((word) => (earlier.get(word) ?? 0) + (later.get(word) ?? 0) >= WORD_TREND_MIN_USES)
        .map((word) => ({ word, earlierRate: wordRate(earlier.get(word) ?? 0, earlierWords), laterRate: wordRate(later.get(word) ?? 0, laterWords) }));
      const delta = (word: WordChange) => word.laterRate - word.earlierRate;
      const rising = changes.filter((word) => delta(word) > 0).sort((a, b) => delta(b) - delta(a) || a.word.localeCompare(b.word)).slice(0, WORD_TREND_TOP);
      const fading = changes.filter((word) => delta(word) < 0).sort((a, b) => delta(a) - delta(b) || a.word.localeCompare(b.word)).slice(0, WORD_TREND_TOP);
      const choices = [...new Set([...words.slice(0, WORD_TREND_TOP).map((row) => row.word), ...rising.map((row) => row.word), ...fading.map((row) => row.word)])];
      return {
        midpointTs, earlierWords, laterWords, rising, fading, choices, bucket,
        buckets: filledBuckets(new Map([...buckets].map(([start, counts]) => [start, counts.totalWords])), bucket).map(({ start, count }) => ({
          start, totalWords: count, counts: Object.fromEntries(choices.map((word) => [word, buckets.get(start)?.words.get(word) ?? 0])),
        })),
      };
    },
  };
}
