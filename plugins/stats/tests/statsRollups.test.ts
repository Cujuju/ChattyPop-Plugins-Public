import { expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_DAY, MS_PER_MIN } from '@plugin-sdk/shared';
import core from '../core';
import { activityStats, postersPage } from '../core/stats';
import { wordStats } from '../core/words';
import { emojiStats } from '../core/emoji';
import { sentimentStats } from '../core/sentiment';
import { conversationStats } from '../core/conversations';
import { peopleStats } from '../core/personHistory';
import { repeatedLinks } from '../core/repeatedLinks';
import type { ActivityQuery } from '../shared/types';

const SETTLE_MS = 20_000; // Parallel plugin checks can delay native helper startup.
const START = Date.UTC(2026, 2, 1);
const CHANNEL = '200000000000000001';
const HIDDEN = '200000000000000002';
const UNKNOWN = '300000000000000003';
const ALL: ActivityQuery = { scope: 'all', channelId: null, sinceTs: null };
const POSTER_LIMIT = 200; // The complete fixture fits within the supported picker-page limit.

it.each([[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]])('matches a full worker fold after every prefix of arrival order %j', async (...order) => {
  const t = testPlugin(core, { archive: { channels: [{ id: CHANNEL }] } });
  onTestFinished(() => t.dispose());
  const c = t.client('renderer');
  const history = [
    { channelId: CHANNEL, ts: START, authorId: 'a', content: 'good café café <:first:12345>' },
    { channelId: CHANNEL, ts: START + MS_PER_DAY, authorId: 'b', content: 'bad café café <:second:12345>' },
    { channelId: CHANNEL, ts: START + MS_PER_MIN, authorId: 'b', content: 'good café café 😀' },
  ];
  for (const index of order) {
    t.archive.arrive([history[index]!]);
    await expect.poll(async () => { const s = await c.rollupStatus(); if (s.error) throw new Error(s.error); return s.building; }, { timeout: SETTLE_MS }).toBe(false);
    expect(await c.activityStats(ALL)).toEqual(await activityStats(t.read, ALL));
    expect(await c.wordStats(ALL)).toEqual(await wordStats(t.read, ALL));
    expect(await c.emojiStats(ALL)).toEqual(await emojiStats(t.read, ALL));
    expect(await c.sentimentStats(ALL)).toEqual(await sentimentStats(t.read, ALL));
    expect(await c.conversationStats(ALL)).toEqual(await conversationStats(t.read, ALL));
  }
});

it('incremental rollups equal rebuilds across reverse arrivals, boundaries, edits, deletes, privacy and restart', async () => {
  let t = testPlugin(core, { archive: { channels: [{ id: CHANNEL }, { id: HIDDEN, hidden: true }] } });
  onTestFinished(async () => { vi.restoreAllMocks(); await t.dispose(); });
  let c = t.client('renderer');
  const settle = async () => {
    await expect.poll(async () => { const s = await c.rollupStatus(); if (s.error) throw new Error(s.error); return s.building; }, { timeout: SETTLE_MS }).toBe(false);
  };
  const same = async (q: ActivityQuery = ALL) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(START + MS_PER_DAY);
    try { expect(await c.activityStats(q)).toEqual(await activityStats(t.read, q)); }
    finally { clock.mockRestore(); }
    expect(await c.peopleStats(q)).toEqual(await peopleStats(t.read, q));
    expect(await c.postersPage({ ...q, offset: 0, limit: POSTER_LIMIT })).toEqual(await postersPage(t.read, { ...q, offset: 0, limit: POSTER_LIMIT }));
    expect(await c.wordStats(q)).toEqual(await wordStats(t.read, q));
    expect(await c.emojiStats(q)).toEqual(await emojiStats(t.read, q));
    expect(await c.sentimentStats(q)).toEqual(await sentimentStats(t.read, q));
    expect(await c.conversationStats(q)).toEqual(await conversationStats(t.read, q));
    expect(await c.repeatedLinks(q)).toEqual(await repeatedLinks(t.read, q));
  };
  const ids = t.archive.arrive([
    { channelId: CHANNEL, ts: START + MS_PER_DAY + MS_PER_MIN, authorId: 'b', content: 'good later later 😀 https://example.org/a' },
    { channelId: CHANNEL, ts: START + MS_PER_DAY - MS_PER_MIN, authorId: 'a', content: 'bad earlier earlier <:old:12345> https://example.org/a' },
    { channelId: CHANNEL, ts: START, authorId: 'a', content: 'steady <@400000000000000004>' },
    { channelId: CHANNEL, ts: START + MS_PER_MIN, authorId: 'b', content: `<#${HIDDEN}> hidden` },
    { channelId: HIDDEN, ts: START, authorId: 'secret', content: 'secret' },
    { channelId: CHANNEL, ts: START + MS_PER_MIN, authorId: 'a', content: `<#${UNKNOWN}> unknown` },
  ]);
  await settle(); await same();
  for (const sinceTs of [START + MS_PER_MIN, START + MS_PER_DAY - MS_PER_MIN + 1]) await same({ ...ALL, sinceTs });
  await same({ ...ALL, authorId: 'a' });
  t.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run('edited pizza <:new:12345>', ids[1]);
  t.db.prepare('DELETE FROM messages WHERE id = ?').run(ids[2]);
  await settle(); await same();
  t.db.prepare('INSERT INTO channels(id, name, kind, hide_in_privacy) VALUES (?, ?, 0, 1)').run(UNKNOWN, 'New hidden');
  await settle();
  for (const privacy of [true, false]) { t.archive.setPrivacyMode(privacy); await same(); }
  const incremental = await c.wordStats(ALL);
  await c.rebuildRollups(); await settle();
  expect(await c.wordStats(ALL)).toEqual(incremental); await same();
  t = t.restart(); c = t.client('renderer'); await settle(); await same();
});

it('stores cross-midnight runs on their opener day and rebuilds split and merged runs', async () => {
  const t = testPlugin(core, { archive: { channels: [{ id: CHANNEL }] } });
  onTestFinished(() => t.dispose());
  const c = t.client('renderer');
  const settle = async () => { await expect.poll(async () => { const s = await c.rollupStatus(); if (s.error) throw new Error(s.error); return s.building; }, { timeout: SETTLE_MS }).toBe(false); };
  const step = MS_PER_MIN;
  const ids = t.archive.arrive(Array.from({ length: 40 }, (_, n) => ({ channelId: CHANNEL, ts: START + MS_PER_DAY - step + n * step, authorId: n % 2 ? 'b' : 'a', content: 'pizza' })).reverse());
  await settle();
  expect(await t.read('SELECT day FROM p_stats_rollup_runs_v1')).toEqual([{ day: '2026-03-01' }]);
  expect((await c.conversationStats({ ...ALL, sinceTs: START + MS_PER_DAY })).conversations).toBe(0);
  t.db.prepare('UPDATE messages SET ts = ts + ? WHERE id = ?').run(MS_PER_DAY, ids[0]);
  await settle();
  expect(await c.conversationStats(ALL)).toEqual(await conversationStats(t.read, ALL));
  await c.rebuildRollups(); await settle();
  expect(await c.conversationStats(ALL)).toEqual(await conversationStats(t.read, ALL));
});

it('rebuilds local calendars after a zone change without reusing old-zone read helpers', async () => {
  const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
  let zone = 'UTC';
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...resolved.call(this), timeZone: zone }; });
  const t = testPlugin(core, { archive: { channels: [{ id: CHANNEL }], messages: [
    { channelId: CHANNEL, ts: START, content: 'good pizza' },
    { channelId: CHANNEL, ts: START + MS_PER_MIN, content: 'bad pizza' },
  ] } });
  onTestFinished(async () => { await t.dispose(); vi.restoreAllMocks(); });
  const c = t.client('renderer');
  const settle = async () => {
    await expect.poll(async () => { const s = await c.rollupStatus(); if (s.error) throw new Error(s.error); return s.building; }, { timeout: SETTLE_MS }).toBe(false);
  };
  await settle();
  expect((await c.activityStats(ALL)).buckets[0]!.start).toBe('2026-03-01');
  zone = 'America/Los_Angeles';
  await settle();
  expect((await c.activityStats(ALL)).buckets[0]!.start).toBe('2026-02-28');
  expect(await c.activityStats(ALL)).toEqual(await activityStats(t.read, ALL));
  expect(await c.wordStats(ALL)).toEqual(await wordStats(t.read, ALL));
});

it('invalidates opener days when deleting and restoring a cross-midnight bridge', async () => {
  const GAP_STEP_MINUTES = 20; // Two adjacent gaps fit one run; deleting their bridge exceeds the thirty-minute gap.
  const MINUTES_BEFORE_MIDNIGHT = 30;
  const t = testPlugin(core, { archive: { channels: [{ id: CHANNEL }] } });
  onTestFinished(() => t.dispose());
  const c = t.client('renderer');
  const first = START + MS_PER_DAY - MINUTES_BEFORE_MIDNIGHT * MS_PER_MIN;
  const messages = [0, 1, 2].map((n) => ({ channelId: CHANNEL, ts: first + n * GAP_STEP_MINUTES * MS_PER_MIN, authorId: n % 2 ? 'b' : 'a', content: 'pizza' }));
  const ids = t.archive.arrive(messages);
  const settle = async () => {
    await expect.poll(async () => { const s = await c.rollupStatus(); if (s.error) throw new Error(s.error); return s.building; }, { timeout: SETTLE_MS }).toBe(false);
  };
  await settle();
  expect((await c.conversationStats(ALL)).conversations).toBe(1);
  t.db.prepare('DELETE FROM messages WHERE id = ?').run(ids[1]);
  await settle();
  expect((await c.conversationStats(ALL)).conversations).toBe(2);
  expect(await c.conversationStats(ALL)).toEqual(await conversationStats(t.read, ALL));
  t.archive.arrive([messages[1]!]);
  await settle();
  expect((await c.conversationStats(ALL)).conversations).toBe(1);
  expect(await c.conversationStats(ALL)).toEqual(await conversationStats(t.read, ALL));
});

it('folds boundary messages whose channel metadata is absent', async () => {
  const t = testPlugin(core, { archive: { channels: [{ id: CHANNEL }] } });
  onTestFinished(() => t.dispose());
  const [id] = t.archive.arrive([{ channelId: CHANNEL, ts: START + MS_PER_MIN, content: 'good pizza' }]);
  t.db.prepare('UPDATE messages SET channel_id = ? WHERE id = ?').run('missing', id);
  const c = t.client('renderer');
  await expect.poll(async () => { const s = await c.rollupStatus(); if (s.error) throw new Error(s.error); return s.building; }, { timeout: SETTLE_MS }).toBe(false);
  const query = { ...ALL, sinceTs: START + 1 };
  expect((await c.activityStats(query)).messages).toBe(1);
  expect((await c.wordStats(query)).totalWords).toBe(2);
});
