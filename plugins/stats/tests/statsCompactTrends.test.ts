import { expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { createWordTrends } from './helpers/wordTrends';
import { SCAN_BATCH_SIZE } from './helpers/scanQueue';
import { en } from 'stopwords-iso/stopwords-iso.json';
import { MIN_WORD_LENGTH } from '../shared/text';
import { wordStats } from '../core/words';

const ALL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;
const MIN_USES = 5; // Five occurrences meet the public trend eligibility threshold.

it('matches the reference through wordStats over reversed page boundaries', async () => {
  const first = new Date(2025, 2, 1).getTime(), middle = new Date(2025, 2, 2).getTime(), last = new Date(2025, 2, 3).getTime();
  const rows = Array.from({ length: SCAN_BATCH_SIZE * 2 + 1 }, (_, i) => ({
    ts: i % 3 === 0 ? first : i % 3 === 1 ? middle : last,
    words: [i % 3 === 0 ? 'earlier' : 'later', 'steady', 'and', `rare${i}`],
  })).reverse();
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }],
    messages: rows.map((r) => ({ channelId: 'c1', ts: r.ts, content: r.words.join(' ') })) } });
  onTestFinished(() => t.dispose());
  const result = await wordStats(t.read, ALL);
  const stop = new Set(en);
  const reference = createWordTrends(result.trends.bucket, (word) => Array.from(word).length >= MIN_WORD_LENGTH && !stop.has(word));
  rows.forEach((r, i) => reference.read(r.ts, r.words, i + 1));
  expect(result.trends).toEqual(await reference.finish(result.words));
});

it('preserves ICU segmentation through the public worker path', async () => {
  const content = "CAFÉ e\u0301lan Ελληνικά русский 中文 ไทย 日本語 42 1,000 can't co-operate term123";
  const reference = [...new Intl.Segmenter('en', { granularity: 'word' }).segment(content)].filter((s) => s.isWordLike);
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: [{ channelId: 'c1', ts: 1, content }] } });
  onTestFinished(() => t.dispose());
  expect((await wordStats(t.read, ALL)).totalWords).toBe(reference.length);
});

it('preserves timestamp-group fallback for collating trend ties through wordStats', async () => {
  const first = 'café', second = 'cafe\u0301';
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: [
    { channelId: 'c1', ts: 0, content: 'and' },
    { channelId: 'c1', ts: 1, content: Array(MIN_USES).fill(first).join(' ') },
    { channelId: 'c1', ts: 0, content: Array(MIN_USES).fill(second).join(' ') },
    { channelId: 'c1', ts: 10, content: 'and' },
  ] } });
  onTestFinished(() => t.dispose());
  const result = await wordStats(t.read, ALL);
  expect(result.words.map((r) => r.word)).toEqual([first, second]);
  expect(result.trends.fading.map((r) => r.word)).toEqual([second, first]);
});
