import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { createWordTrends } from '../core/wordTrends';
import { SCAN_BATCH_SIZE } from '../core/scan';
import { bucketStart, filledBuckets } from '../core/histogram';
import { WORD_RATE_BASE, WORD_TREND_TOP } from '../shared/wordTrends';
import { tokenize } from '../core/tokenize';
import { wordStats } from '../core/words';
import { rankedTop } from '../core/rankedTop';

describe('Analytics compact word history', () => {
  it('keeps exact midpoint and selected bucket counts over compact page boundaries and reversed history', async () => {
    const history = createWordTrends('week', (word) => word !== 'and');
    const first = new Date(2025, 2, 1).getTime();
    const middle = new Date(2025, 2, 2).getTime();
    const last = new Date(2025, 2, 3).getTime();
    const rows = Array.from({ length: SCAN_BATCH_SIZE * 2 + 1 }, (_, index) => ({
      ts: index % 3 === 0 ? first : index % 3 === 1 ? middle : last,
      words: [index % 3 === 0 ? 'earlier' : 'later', 'steady', 'and', `rare${index}`],
    })).reverse();
    let eligibilityCalls = 0;
    const counts = new Map<string, number>();
    const cached = createWordTrends('week', (word) => { eligibilityCalls++; return word !== 'and'; });
    for (const row of rows) {
      history.read(row.ts, row.words);
      cached.read(row.ts, row.words);
      for (const word of row.words) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    let serviced = false;
    setImmediate(() => { serviced = true; });
    const result = await history.finish([{ word: 'steady', count: rows.length }]);
    expect(serviced).toBe(true);
    expect(result.midpointTs).toBe(middle);
    const early = rows.filter((row) => row.ts < middle).length;
    const late = rows.length - early;
    expect([result.earlierWords, result.laterWords]).toEqual([early * 4, late * 4]);
    expect(result.rising).toEqual([{ word: 'later', earlierRate: 0, laterRate: WORD_RATE_BASE / 4 }]);
    expect(result.fading).toEqual([{ word: 'earlier', earlierRate: WORD_RATE_BASE / 4, laterRate: 0 }]);
    expect(result.choices).toEqual(['steady', 'later', 'earlier']);
    const buckets = new Map<string, number>();
    for (const row of rows) {
      const start = bucketStart(new Date(row.ts), 'week');
      buckets.set(start, (buckets.get(start) ?? 0) + row.words.length);
    }
    expect(result.buckets.map(({ start, totalWords }) => ({ start, count: totalWords }))).toEqual(filledBuckets(buckets, 'week'));
    for (const bucket of result.buckets) for (const word of result.choices) {
      expect(bucket.counts[word]).toBe(rows.filter((row) => bucketStart(new Date(row.ts), 'week') === bucket.start)
        .reduce((sum, row) => sum + row.words.filter((token) => token === word).length, 0));
    }
    expect(result.choices.length).toBeLessThanOrEqual(WORD_TREND_TOP * 3);
    expect(await cached.finish([{ word: 'steady', count: rows.length }])).toEqual(result);
    expect(eligibilityCalls).toBe(counts.size);
  });

  it('preserves ICU segmentation for multilingual text, numbers, combining marks and punctuation', () => {
    const content = "CAFÉ e\u0301lan Ελληνικά русский 中文 ไทย 日本語 42 1,000 can't co-operate term123";
    const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
    const reference = [...segmenter.segment(content)].filter((segment) => segment.isWordLike).map((segment) => segment.segment.toLowerCase());
    expect(tokenize(content)).toEqual(reference);
  });

  it('preserves ingestion order when locale collation equates distinct word spellings', async () => {
    const first = 'café';
    const second = 'cafe\u0301';
    expect(first.localeCompare(second)).toBe(0);
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: [
      { channelId: 'c1', ts: 1, content: Array(5).fill(first).join(' ') },
      { channelId: 'c1', ts: 0, content: Array(5).fill(second).join(' ') },
      { channelId: 'c1', ts: 10, content: 'and' },
    ] } });
    onTestFinished(() => t.dispose());
    const result = await wordStats(t.db, { scope: 'channel', channelId: 'c1', sinceTs: null });
    expect(result.words.map((row) => row.word)).toEqual([first, second]);
    expect(result.trends.fading.map((row) => row.word)).toEqual([first, second]);

    // A timestamp group's first ingestion precedes a word that arrives later in that group.
    const grouped = createWordTrends('day', (word) => word !== 'and');
    grouped.read(0, ['and'], 1);
    grouped.read(0, Array(5).fill(second), 3);
    grouped.read(1, Array(5).fill(first), 2);
    grouped.read(10, ['and'], 4);
    expect((await grouped.finish([])).fading.map((row) => row.word)).toEqual([second, first]);
  });

  it.each([0, 1, WORD_TREND_TOP])('matches a stable full ranking while retaining only %s rows', (limit) => {
    const rows = Array.from({ length: SCAN_BATCH_SIZE }, (_, id) => ({ id, count: id % WORD_TREND_TOP })).reverse();
    const compare = (a: typeof rows[number], b: typeof rows[number]) => b.count - a.count;
    expect(rankedTop(rows, limit, compare)).toEqual([...rows].sort(compare).slice(0, limit));
  });
});
