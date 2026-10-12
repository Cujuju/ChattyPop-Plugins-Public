import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import statsCore from '../core';
import { SENTIMENT_MIN_SAMPLE, sentimentFractions, type SentimentStats } from '../shared/text';

const START = new Date(2026, 8, 7).getTime();
const LONG_SPAN_DAYS = 200;
const CHANNEL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;
const bucket = (messages: number, positive: number, negative = 0): SentimentStats['buckets'][number] => ({ start: '2026-09-07', messages, positive, negative });

describe('Analytics sentiment strips', () => {
  it('scales shares only against rated buckets, keeping order and leaving the source untouched', () => {
    const buckets = [bucket(1, 1, 1), bucket(100, 17, 9), bucket(100, 19, 3), bucket(SENTIMENT_MIN_SAMPLE - 1, 30, 20), bucket(0, 0)];
    const copy = structuredClone(buckets);
    expect(sentimentFractions(buckets, 'positive')).toEqual(['unrated', 17 / 19, 1, 'unrated', 'unrated']);
    expect(sentimentFractions(buckets, 'negative')).toEqual(['unrated', 1, 1 / 3, 'unrated', 'unrated']);
    expect(buckets).toEqual(copy);
  });

  it('handles all unrated buckets and an empty strip', () => {
    expect(sentimentFractions([bucket(0, 0), bucket(SENTIMENT_MIN_SAMPLE - 1, 1)], 'positive')).toEqual(['unrated', 'unrated']);
    expect(sentimentFractions([], 'positive')).toEqual([]);
  });

  it('rates the minimum sample inclusively and makes a single nonzero share full height', () => {
    expect(sentimentFractions([bucket(1, 1), bucket(SENTIMENT_MIN_SAMPLE, 1)], 'positive')).toEqual(['unrated', 1]);
  });

  it('keeps rated zero shares finite and distinct from unrated buckets', () => {
    expect(sentimentFractions([bucket(0, 0), bucket(SENTIMENT_MIN_SAMPLE, 0), bucket(100, 0)], 'positive')).toEqual(['unrated', 0, 0]);
    expect(sentimentFractions([bucket(100, 0), bucket(100, 10)], 'positive')).toEqual([0, 1]);
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
  return { t, core: t.client('renderer') };
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
    expect((await core.sentimentStats({ ...CHANNEL, scope: 'server' })).textMessages).toBe(6);
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
