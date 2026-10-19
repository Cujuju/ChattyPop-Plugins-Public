import { expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_DAY, MS_PER_MIN } from '@plugin-sdk/shared';
import * as reads from '@core/reads/archiveReads';
import core from '../core';
import { activityStats } from '../core/stats';
import { emojiStats } from '../core/emoji';
import { sentimentStats } from '../core/sentiment';
import { peopleStats } from '../core/personHistory';
import { repeatedLinks } from '../core/repeatedLinks';
import { wordStats } from '../core/words';
import { conversationStats } from '../core/conversations';
import { publishedReads } from '../core/publishedReads';
import type { StatsRollups } from '../core/rollups';

const START = Date.UTC(2026, 0, 1);
const WEEK_DAYS = 7; // Exercise the panel's sliding seven-day range.
const HISTORY_DAYS = 21; // Clean history extends beyond the requested range.
const SETTLE_MS = 20_000; // Includes initial helper startup on shared runners.
const DRAIN_BUDGET_MS = 5_000; // A handful of dirty channel-days must settle in seconds.
const QUERY = { scope: 'all', channelId: null, sinceTs: START + (HISTORY_DAYS - WEEK_DAYS) * MS_PER_DAY, range: '7d' } as const;

it('answers current seven-day reads while incremental publication is held, then drains in seconds', async () => {
  const t = testPlugin(core, { archive: { channels: [{ id: 'channel' }], messages: Array.from({ length: HISTORY_DAYS }, (_, day) =>
    ({ channelId: 'channel', ts: START + day * MS_PER_DAY, content: 'old pizza', authorId: 'a' })) } });
  onTestFinished(() => t.dispose());
  const c = t.client('renderer');
  const settle = () => expect.poll(async () => (await c.rollupStatus()).maintaining, { timeout: SETTLE_MS }).toBe(false);
  await settle();
  expect((await c.activityStats(QUERY)).data?.messages).toBe(WEEK_DAYS);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = reads.computeArchive;
  const jobs: unknown[] = [];
  const spy = vi.spyOn(reads, 'computeArchive').mockImplementation(async (...args) => {
    if (args[1].partition) { jobs.push(args[1].partition); await gate; }
    return original(...args);
  });
  try {
    t.archive.arrive([{ channelId: 'channel', ts: START + (HISTORY_DAYS - 1) * MS_PER_DAY + MS_PER_MIN, content: 'fresh pizza', authorId: 'b' }]);
    await expect.poll(() => jobs.length, { timeout: SETTLE_MS }).toBeGreaterThan(0);
    expect(await c.rollupStatus()).toMatchObject({ building: false, maintaining: true });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(START + HISTORY_DAYS * MS_PER_DAY);
    onTestFinished(() => clock.mockRestore());
    const counts = await c.activityStats(QUERY), words = await c.wordStats(QUERY), runs = await c.conversationStats(QUERY);
    expect(counts.building).toBe(false); expect(words.building).toBe(false); expect(runs.building).toBe(false);
    expect(counts.data).toEqual(await activityStats(t.read, QUERY));
    expect(words.data).toEqual(await wordStats(t.read, QUERY));
    expect(runs.data).toEqual(await conversationStats(t.read, QUERY));
    expect(counts.data?.messages).toBe(WEEK_DAYS + 1);
    expect((await c.emojiStats(QUERY)).data).toEqual(await emojiStats(t.read, QUERY));
    expect((await c.sentimentStats(QUERY)).data).toEqual(await sentimentStats(t.read, QUERY));
    expect((await c.peopleStats(QUERY)).data).toEqual(await peopleStats(t.read, QUERY));
    expect((await c.repeatedLinks(QUERY)).data).toEqual(await repeatedLinks(t.read, QUERY));
    clock.mockRestore();
    const started = performance.now(); release(); await settle();
    const elapsed = performance.now() - started;
    process.stdout.write(`incremental drain: ${elapsed.toFixed(2)} ms, ${jobs.length} partition jobs\n`);
    expect(elapsed).toBeLessThan(DRAIN_BUDGET_MS);
    expect(jobs.every((part) => typeof part === 'object')).toBe(true);
  } finally { release(); spy.mockRestore(); }
});

it('retains full-build results across relative-range clock drift without sharing other ranges', async () => {
  let building = false;
  const r = { status: () => ({ building, dirty: 1, total: 2, error: null }), visibilityToken: () => 'visible' };
  const publish = publishedReads({ counts: r, text: r, links: r, runs: r } as unknown as StatsRollups);
  expect((await publish('words', QUERY, async () => [1])).data).toEqual([1]);
  building = true;
  const load = vi.fn(async () => [2]);
  expect(await publish('words', { ...QUERY, sinceTs: QUERY.sinceTs + MS_PER_MIN }, load)).toMatchObject({ building: true, data: [1] });
  expect((await publish('words', { ...QUERY, range: '30d' }, load)).data).toBeNull();
  expect(load).not.toHaveBeenCalled();
});
