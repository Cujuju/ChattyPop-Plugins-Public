import { analyticsClient } from './analyticsClient';
import { describe, expect, it, onTestFinished } from 'vitest';
import { DEFAULT_GUILD, testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import statsCore from '../core';
import { sentimentScale, uncancelledShare, type SentimentBucket } from '../shared/text';

const START = new Date(2026, 8, 7).getTime();
const LONG_SPAN_DAYS = 200;
const CHANNEL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;
const bucket = (positive: number, negative: number): SentimentBucket => ({ start: '2026-09-07', messages: positive + negative, positive, negative });

describe('Analytics sentiment chart', () => {
  it('scales both directions by the longest bar either way', () => {
    expect(sentimentScale([bucket(17, 9), bucket(3, 19), bucket(0, 0)])).toBe(19);
    expect(sentimentScale([bucket(17, 9), bucket(3, 4)])).toBe(17);
  });

  it('has no scale without counted messages', () => {
    expect(sentimentScale([bucket(0, 0)])).toBe(0);
    expect(sentimentScale([])).toBe(0);
  });

  it('fills only the longer bar, by the share its opposite leaves', () => {
    expect(uncancelledShare(20, 5)).toBe(15 / 20);
    expect(uncancelledShare(5, 20)).toBe(0);
    expect(uncancelledShare(8, 0)).toBe(1);
  });

  it('fills neither bar of a tie or an empty bucket', () => {
    expect(uncancelledShare(7, 7)).toBe(0);
    expect(uncancelledShare(0, 0)).toBe(0);
  });
});

function start() {
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages: [
    { channelId: 'c1', ts: START, content: 'GOOD good' },
    { channelId: 'c1', ts: START + 1, content: 'bad' },
    { channelId: 't1', ts: START + MS_PER_DAY, content: 'good bad' },
    { channelId: 'c1', ts: START + MS_PER_DAY + 1, content: 'pizza constructor https://example.com/good <:good:123> ```bad``` <@123>' },
    { channelId: 'c1', ts: START + MS_PER_DAY + 2, content: ' \t\n' },
    { channelId: 'c2', ts: START, content: 'good' },
    { channelId: 'hidden', ts: START, content: 'bad' },
  ] } });
  onTestFinished(() => t.dispose());
  return { t, core: analyticsClient(t) };
}

describe('Analytics sentiment', () => {
  it('scores whole messages from sanitized words and counts class shares per local day', async () => {
    const stats = await start().core.sentimentStats(CHANNEL);
    expect(stats.textMessages).toBe(4);
    expect(stats.classes).toEqual({ positive: 1, negative: 1, neutral: 2 });
    expect(stats.bucket).toBe('day');
    expect(stats.buckets).toEqual([
      { start: '2026-09-07', positive: 1, negative: 1, messages: 2 },
      { start: '2026-09-08', positive: 0, negative: 0, messages: 2 },
    ]);
  });

  it('honors scope, range and privacy with empty-range results', async () => {
    const { t, core } = start();
    expect((await core.sentimentStats({ ...CHANNEL, sinceTs: START + MS_PER_DAY })).classes).toEqual({ positive: 0, negative: 0, neutral: 2 });
    expect((await core.sentimentStats({ ...CHANNEL, scope: 'server', guildId: DEFAULT_GUILD.id })).textMessages).toBe(6);
    t.archive.setPrivacyMode(true);
    expect((await core.sentimentStats({ scope: 'all', channelId: null, sinceTs: null })).classes).toEqual({ positive: 2, negative: 1, neutral: 2 });
    const empty = await core.sentimentStats({ ...CHANNEL, channelId: null });
    expect([empty.textMessages, empty.classes, empty.buckets]).toEqual([0, { positive: 0, negative: 0, neutral: 0 }, []]);
  });

  it('shares the message histogram week rule and fills quiet weeks', async () => {
    const { t, core } = start();
    t.archive.arrive([{ channelId: 'c1', ts: START - LONG_SPAN_DAYS * MS_PER_DAY, content: 'good' }]);
    const stats = await core.sentimentStats(CHANNEL);
    expect(stats.bucket).toBe((await core.activityStats(CHANNEL)).bucket);
    expect(stats.buckets.at(-1)).toEqual({ start: '2026-09-07', positive: 1, negative: 1, messages: 4 });
    expect(stats.buckets.slice(1, -1).every((bucket) => bucket.messages === 0)).toBe(true);
    expect(stats.buckets.reduce((sum, bucket) => sum + bucket.messages, 0)).toBe(stats.textMessages);
  });
});
