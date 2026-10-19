import { expect, it, vi } from 'vitest';
import type { ArchiveRead } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { textReadWork } from '../core/textReadWork';

const START = Date.UTC(2026, 0, 1);
const HALVES = 2; // Midpoints divide the extent into two halves.
const WEEK_DAYS = 7; // Local calendar weeks have seven days.
const DAY_BUCKETS_MAX_DAYS = 120; // Match the production chart's switch to weekly buckets.
const TOP = 30; // The summary fixture stays below the panel's bounded ranking size.

it.each(['sentiment', 'emoji'])('folds packed %s counts without loading person identities', async (section) => {
  const rows = [
    { kind: 'extent', first_ts: START, last_ts: START, payload: 'Identity is unused by this section' },
    { kind: 'lengths', date: '2026-01-01', first_ts: START, last_ts: START, payload: JSON.stringify([[0, 2, 0, 0], [2, 3, 1, 1]]) },
    { kind: 'emoji', term: 'unicode:😀', n: 3, seq: 1, position: 0, payload: JSON.stringify({ id: null, name: '😀', animated: false }) },
  ];
  const read = vi.fn(async () => rows);
  const [result] = await textReadWork(null, read as ArchiveRead, new AbortController().signal, {
    compute: 'async () => []', config: {}, cuts: [], view: 'fixture', rowsSql: 'fixture', memberParams: [], section,
    dayMs: MS_PER_DAY, halves: HALVES, weekDays: WEEK_DAYS, maxDayBuckets: DAY_BUCKETS_MAX_DAYS, sinceTs: null, top: TOP,
  });
  expect(result.textMessages).toBe(5);
  if (section === 'sentiment') {
    expect(result.classes).toEqual({ positive: 1, negative: 1, neutral: 3 });
    expect(result.buckets).toEqual([{ start: '2026-01-01', positive: 1, negative: 1, messages: 5 }]);
  } else expect(result.emoji).toEqual([{ id: null, name: '😀', animated: false, count: 3 }]);
  expect(read).toHaveBeenCalledTimes(1);
});
