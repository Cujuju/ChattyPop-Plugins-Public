import { WORD_TREND_MIN_USES, WORD_TREND_TOP, wordRate, type WordChange, type WordTrends } from '../../shared/wordTrends';
import type { WordCount } from '../../shared/text';
import type { ActivityStats } from '../../shared/types';
import { bucketStart, filledBuckets } from './histogram';
import { SCAN_BATCH_SIZE, yieldToQueue } from './scanQueue';
import { rankedTop } from './rankedTop';

interface WordPage {
  times: Float64Array;
  sequences: Float64Array;
  totals: Float64Array;
  ends: Uint32Array;
  words: Uint32Array;
  size: number;
}

/** Compact token ids preserve the actual text midpoint, even if visibility changes during the scan. Only selected words get bucket maps. */
export function createWordTrends(bucket: ActivityStats['bucket'], eligible: (word: string) => boolean) {
  const pages: WordPage[] = [];
  const ids = new Map<string, number>();
  const names: string[] = [];
  let times = new Float64Array(SCAN_BATCH_SIZE);
  let sequences = new Float64Array(SCAN_BATCH_SIZE);
  let totals = new Float64Array(SCAN_BATCH_SIZE);
  let ends = new Uint32Array(SCAN_BATCH_SIZE);
  let tokens: number[] = [];
  let size = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let readSequence = 0;
  const timeOrder = new Map<number, number>();
  const seal = () => {
    if (!size) return;
    pages.push({ times, sequences, totals, ends, words: Uint32Array.from(tokens), size });
    times = new Float64Array(SCAN_BATCH_SIZE);
    sequences = new Float64Array(SCAN_BATCH_SIZE);
    totals = new Float64Array(SCAN_BATCH_SIZE);
    ends = new Uint32Array(SCAN_BATCH_SIZE);
    tokens = [];
    size = 0;
  };
  return {
    read(ts: number, words: string[], seq = ++readSequence) {
      firstTs = Math.min(firstTs ?? ts, ts);
      lastTs = Math.max(lastTs ?? ts, ts);
      times[size] = ts;
      sequences[size] = seq;
      timeOrder.set(ts, Math.min(timeOrder.get(ts) ?? seq, seq));
      totals[size] = words.length;
      for (const word of words) {
        let id = ids.get(word);
        if (id === undefined) {
          id = eligible(word) ? names.length : -1;
          if (id >= 0) names.push(word);
          ids.set(word, id);
        }
        if (id >= 0) tokens.push(id);
      }
      ends[size++] = tokens.length;
      if (size === SCAN_BATCH_SIZE) seal();
    },
    async finish(words: WordCount[]): Promise<WordTrends> {
      seal();
      const midpointTs = firstTs === null || lastTs === null ? null : firstTs + (lastTs - firstTs) / 2;
      const earlier = new Float64Array(names.length);
      const later = new Float64Array(names.length);
      type Order = [number, number, number];
      const earlierOrder = new Map<number, Order>();
      const laterOrder = new Map<number, Order>();
      let earlierWords = 0;
      let laterWords = 0;
      for (const page of pages) {
        let offset = 0;
        for (let row = 0; row < page.size; row++) {
          const half = page.times[row]! < midpointTs! ? earlier : later;
          const orders = half === earlier ? earlierOrder : laterOrder;
          const group = timeOrder.get(page.times[row]!)!;
          const seq = page.sequences[row]!;
          if (half === earlier) earlierWords += page.totals[row]!;
          else laterWords += page.totals[row]!;
          const begin = offset;
          while (offset < page.ends[row]!) {
            const position = offset - begin;
            const id = page.words[offset++]!;
            half[id]!++;
            const order = orders.get(id);
            if (!order || group < order[0] || (group === order[0] && (seq < order[1] || (seq === order[1] && position < order[2])))) {
              orders.set(id, [group, seq, position]);
            }
          }
        }
        await yieldToQueue();
      }
      timeOrder.clear();
      const changes: WordChange[] = names.flatMap((word, id) => earlier[id]! + later[id]! >= WORD_TREND_MIN_USES
        ? [{ word, earlierRate: wordRate(earlier[id]!, earlierWords), laterRate: wordRate(later[id]!, laterWords) }] : []);
      const delta = (word: WordChange) => word.laterRate - word.earlierRate;
      // localeCompare can equate distinct Unicode spellings. Preserve the original timestamp-group insertion order for those ties.
      const insertionOrder = (a: WordChange, b: WordChange) => {
        const aId = ids.get(a.word)!;
        const bId = ids.get(b.word)!;
        const aEarly = earlierOrder.has(aId);
        const bEarly = earlierOrder.has(bId);
        if (aEarly !== bEarly) return aEarly ? -1 : 1;
        const aOrder = (aEarly ? earlierOrder : laterOrder).get(aId)!;
        const bOrder = (bEarly ? earlierOrder : laterOrder).get(bId)!;
        return aOrder[0] - bOrder[0] || aOrder[1] - bOrder[1] || aOrder[2] - bOrder[2];
      };
      const rising = rankedTop(changes.filter((word) => delta(word) > 0), WORD_TREND_TOP,
        (a, b) => delta(b) - delta(a) || a.word.localeCompare(b.word) || insertionOrder(a, b));
      const fading = rankedTop(changes.filter((word) => delta(word) < 0), WORD_TREND_TOP,
        (a, b) => delta(a) - delta(b) || a.word.localeCompare(b.word) || insertionOrder(a, b));
      const choices = [...new Set([...words.slice(0, WORD_TREND_TOP).map((row) => row.word), ...rising.map((row) => row.word), ...fading.map((row) => row.word)])];
      const chosenIds = new Set(choices.map((word) => ids.get(word)!));
      const buckets = new Map<string, { totalWords: number; words: Map<string, number> }>();
      let dayStart = NaN;
      let dayEnd = NaN;
      let start = '';
      for (const page of pages) {
        let offset = 0;
        for (let row = 0; row < page.size; row++) {
          const ts = page.times[row]!;
          // Cache a local calendar day, never a fixed 24-hour interval across daylight-saving changes.
          if (!(ts >= dayStart && ts < dayEnd)) {
            const date = new Date(ts);
            start = bucketStart(date, bucket);
            date.setHours(0, 0, 0, 0);
            dayStart = date.getTime();
            date.setDate(date.getDate() + 1);
            dayEnd = date.getTime();
          }
          const period = buckets.get(start) ?? { totalWords: 0, words: new Map<string, number>() };
          period.totalWords += page.totals[row]!;
          while (offset < page.ends[row]!) {
            const id = page.words[offset++]!;
            if (chosenIds.has(id)) {
              const word = names[id]!;
              period.words.set(word, (period.words.get(word) ?? 0) + 1);
            }
          }
          buckets.set(start, period);
        }
        await yieldToQueue();
      }
      return {
        midpointTs, earlierWords, laterWords, rising, fading, choices, bucket,
        buckets: filledBuckets(new Map([...buckets].map(([start, counts]) => [start, counts.totalWords])), bucket).map(({ start, count }) => ({
          start, totalWords: count, counts: Object.fromEntries(choices.map((word) => [word, buckets.get(start)?.words.get(word) ?? 0])),
        })),
      };
    },
  };
}
