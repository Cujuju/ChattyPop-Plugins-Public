import { expect, it, onTestFinished, vi } from 'vitest';
import { defineCorePlugin, type ArchiveRead } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import core from '../core';
import { plugin, type AnalyticsRead } from '../shared';
import { publishedReads } from '../core/publishedReads';
import type { StatsRollups } from '../core/rollups';

const QUERY = { scope: 'all', channelId: null, sinceTs: null } as const;
const MEMBERS = ['activityStats', 'peopleStats', 'postersPage', 'personStreaks', 'personHistory', 'voiceStats', 'repeatedLinks',
  'emojiStats', 'wordStats', 'sentimentStats', 'conversationStats'] as const;
const SETTLE_MS = 20_000; // Include helper startup on the shared test machine.

it('uses one bounded pending contract for every panel read and revokes stale data on privacy changes', async () => {
  let forced = true;
  const read = vi.fn();
  const wrapped = defineCorePlugin(plugin, (ctx) => core.activate({ ...ctx,
    storage: { ...ctx.storage, read: ((...args) => { read(...args); return ctx.storage.read(...args); }) as ArchiveRead },
    rollups: { define: (name, spec) => {
      const r = ctx.rollups.define(name, spec), status = r.status.bind(r);
      r.status = () => forced ? { building: true, dirty: 1, total: 2, error: null } : status();
      return r;
    } },
  }));
  const t = testPlugin(wrapped, { archive: { channels: [{ id: 'channel' }, { id: 'private', hidden: true }],
    messages: [{ channelId: 'channel', ts: 1, content: 'good pizza' }, { channelId: 'private', ts: 2, content: 'secret' }] } });
  onTestFinished(() => t.dispose());
  const c = t.client('renderer');
  const args = (member: string) => ({ ...QUERY, ...(member === 'postersPage' ? { offset: 0, limit: 200 } : {}) });
  const call = (member: typeof MEMBERS[number], q: any = args(member)) => (c[member] as (q: any) => Promise<AnalyticsRead<unknown>>)(q);
  for (const member of MEMBERS) expect(await call(member)).toEqual({ data: null, building: true, done: 4, total: 8 });
  expect(read).not.toHaveBeenCalled();
  forced = false;
  await expect.poll(async () => (await c.rollupStatus()).building, { timeout: SETTLE_MS }).toBe(false);
  const published = new Map<string, unknown>();
  for (const member of MEMBERS) {
    const result = await call(member);
    expect(result.building).toBe(false); expect(result.data).not.toBeNull(); published.set(member, result.data);
  }
  forced = true; read.mockClear();
  for (const member of MEMBERS) expect((await call(member)).data).toEqual(published.get(member));
  expect((await call('wordStats', { ...QUERY, channelId: 'different' })).data).toBeNull();
  expect(read).not.toHaveBeenCalled();
  t.archive.setPrivacyMode(true);
  for (const member of MEMBERS) expect((await call(member)).data).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it('discards a projection superseded during its read and retains the last published value', async () => {
  let building = false, visibility = 'visible';
  const r = { status: () => ({ building, dirty: building ? 1 : 0, total: 2, error: null }), visibilityToken: () => visibility };
  const publish = publishedReads({ counts: r, links: r, text: r, runs: r } as unknown as StatsRollups);
  expect((await publish('words', QUERY, async () => [1])).data).toEqual([1]);
  const result = await publish('words', QUERY, async () => { building = true; return [2]; });
  expect(result).toEqual({ data: [1], building: true, done: 4, total: 8 });
  visibility = 'hidden';
  expect((await publish('words', QUERY, async () => [3])).data).toBeNull();
});
