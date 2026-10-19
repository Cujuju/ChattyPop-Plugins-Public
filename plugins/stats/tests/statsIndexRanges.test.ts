import { analyticsClient } from './analyticsClient';
import { expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import core from '../core';
import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import type { StatsRollups } from '../core/rollups';
import { activityStats } from '../core/stats';
import { wordStats } from '../core/words';
import { emojiStats } from '../core/emoji';
import { sentimentStats } from '../core/sentiment';
import type { ActivityQuery } from '../shared/types';

const START = Date.UTC(2025, 10, 1);
const DAYS = [0, 1, 31, 32, 61, 62, 95, 96, 130];
const SETTLE_MS = 20_000; // Helpers may share the machine with build verification.

it('matches full folds across months, years, partial days, people and combined channels', async () => {
  const rollups = {} as StatsRollups;
  const observed = defineCorePlugin(plugin, (ctx) => core.activate({ ...ctx, rollups: {
    define: (name, spec) => {
      const r = ctx.rollups.define(name, spec);
      Object.assign(rollups, { [name === 'shares' ? 'links' : name]: r });
      return r;
    },
  } }));
  const t = testPlugin(observed, { archive: { channels: [{ id: 'a' }, { id: 'b' }] } });
  onTestFinished(() => t.dispose());
  const c = analyticsClient(t);
  const settle = async () => expect.poll(async () => { const s = await c.rollupStatus(); if (s.error) throw new Error(s.error); return s.maintaining; }, { timeout: SETTLE_MS }).toBe(false);
  t.archive.arrive(DAYS.flatMap((day, i) => ['a', 'b'].map((channelId) => ({ channelId, ts: START + day * MS_PER_DAY + i,
    authorId: i % 2 ? 'one' : 'two', content: `${'pizza '.repeat(i + 1)}good café café 😀 <:wave:12345>` }))).reverse());
  await settle();
  const queries: ActivityQuery[] = [
    { scope: 'all', channelId: null, sinceTs: null },
    { scope: 'channel', channelId: 'a', sinceTs: null },
    { scope: 'all', channelId: null, sinceTs: START + 31 * MS_PER_DAY },
    ...[0, 1, 32, 61, 96].map((d) => ({ scope: 'all' as const, channelId: null, sinceTs: START + d * MS_PER_DAY + 1 })),
    { scope: 'all', channelId: null, sinceTs: START + 1, authorId: 'one' },
  ];
  for (const q of queries) {
    expect(await c.wordStats(q)).toEqual(await wordStats(t.read, q));
    expect(await c.emojiStats(q)).toEqual(await emojiStats(t.read, q));
    expect(await c.sentimentStats(q)).toEqual(await sentimentStats(t.read, q));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(START + 131 * MS_PER_DAY);
    try { expect(await c.activityStats(q)).toEqual(await activityStats(t.read, q)); }
    finally { clock.mockRestore(); }
  }
  for (const [since, until] of [[1, 32], [31, 96], [40, 80], [130, 131]]) {
    const q = { scope: 'channels' as const, channelIds: ['a', 'b'], sinceTs: START + since! * MS_PER_DAY + 1, untilTs: START + until! * MS_PER_DAY + 1 };
    expect(await wordStats(t.read, q, undefined, rollups)).toEqual(await wordStats(t.read, q));
  }
  const aligned = { scope: 'channels' as const, channelIds: ['a', 'b'], sinceTs: START + 31 * MS_PER_DAY, untilTs: START + 96 * MS_PER_DAY - 1 };
  expect(await wordStats(t.read, aligned, undefined, rollups)).toEqual(await wordStats(t.read, aligned));
  const before = await c.wordStats(queries[0]!);
  await c.rebuildRollups(); await settle();
  expect(await c.wordStats(queries[0]!)).toEqual(before);
});
