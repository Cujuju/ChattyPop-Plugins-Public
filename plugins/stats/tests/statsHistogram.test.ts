import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { analyticsArchive } from './statsFixture';

const ALL_TIME = { scope: 'all', channelId: null, sinceTs: null } as const;
const YEAR = 2026;
const MARCH = 2;
const SEPTEMBER = 8;

describe('Analytics time buckets', () => {
  it('keeps quiet days across daylight-saving changes between the first and last message', async () => {
    const t = testPlugin(statsCore, { archive: {
      channels: [{ id: 'c1' }],
      messages: [
        { channelId: 'c1', ts: new Date(YEAR, MARCH, 7).getTime(), content: 'before' },
        { channelId: 'c1', ts: new Date(YEAR, MARCH, 10).getTime(), content: 'after' },
      ],
    } });
    onTestFinished(() => t.dispose());
    const s = await t.client('renderer').activityStats(ALL_TIME);
    expect(s.bucket).toBe('day');
    expect(s.buckets).toEqual([
      { start: '2026-03-07', count: 1 },
      { start: '2026-03-08', count: 0 },
      { start: '2026-03-09', count: 0 },
      { start: '2026-03-10', count: 1 },
    ]);
  });

  it('keeps quiet Monday-start weeks across month boundaries', async () => {
    const t = testPlugin(statsCore, { archive: {
      channels: [{ id: 'c1' }],
      messages: [
        { channelId: 'c1', ts: new Date(YEAR, MARCH, 7).getTime(), content: 'before' },
        { channelId: 'c1', ts: new Date(YEAR, SEPTEMBER, 13).getTime(), content: 'after' },
      ],
    } });
    onTestFinished(() => t.dispose());
    const s = await t.client('renderer').activityStats(ALL_TIME);
    expect(s.bucket).toBe('week');
    expect(s.buckets).toHaveLength(28);
    expect(s.buckets[0]).toEqual({ start: '2026-03-02', count: 1 });
    expect(s.buckets[1]).toEqual({ start: '2026-03-09', count: 0 });
    expect(s.buckets.at(-1)).toEqual({ start: '2026-09-07', count: 1 });
    expect(s.buckets.slice(1, -1).every((b) => b.count === 0)).toBe(true);
  });

  it.each([false, true])('preserves fixture message totals in bars and heatmap (privacy: %s)', async (privacyMode) => {
    const t = testPlugin(statsCore, { archive: analyticsArchive() });
    onTestFinished(() => t.dispose());
    t.archive.setPrivacyMode(privacyMode);
    for (const scope of ['all', 'channel', 'server'] as const) {
      const s = await t.client('renderer').activityStats({ ...ALL_TIME, scope, channelId: 'c1' });
      expect(s.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(s.messages);
      expect(s.heatmap.flat().reduce((sum, count) => sum + count, 0)).toBe(s.messages);
    }
  });

  it('has no bars when the archive has no messages', async () => {
    const t = testPlugin(statsCore);
    onTestFinished(() => t.dispose());
    expect((await t.client('renderer').activityStats(ALL_TIME)).buckets).toEqual([]);
  });
});
