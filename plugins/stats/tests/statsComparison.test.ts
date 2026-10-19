import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { DEFAULT_GUILD, testPlugin, type SeedArchive } from '@plugin-sdk/core/testing';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import statsCore from '../core';
import { comparisonDelta } from '../renderer/comparison';
import type { ActivityQuery } from '../shared/types';

const NOW = new Date(2026, 8, 14).getTime();
const SPAN = 7 * MS_PER_DAY;
const SINCE = NOW - SPAN;
const START = SINCE - SPAN;
const CHANNEL: ActivityQuery = { scope: 'channel', channelId: 'c1', sinceTs: SINCE };

function start(messages: SeedArchive['messages']) {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const t = testPlugin(statsCore, { archive: {
    channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages,
  } });
  onTestFinished(() => { t.dispose(); clock.mockRestore(); });
  return { t, core: t.client('renderer') };
}

describe('Analytics preceding period', () => {
  it('compares every headline over the equal, half-open preceding interval', async () => {
    const { core } = start([
      { channelId: 'c1', ts: START - 1, content: 'outside' },
      { channelId: 'c1', ts: START, content: 'old https://example.com', extra: {
        edited_timestamp: new Date(START + 1).toISOString(),
        attachments: [{ id: 'a1', filename: 'image.png', url: 'https://cdn.example/a', size: 0 }],
      } },
      { channelId: 't1', ts: SINCE - 1, content: '' },
      { channelId: 'c1', ts: SINCE, content: 'now https://example.com' },
      { channelId: 't1', ts: SINCE + 1, content: '', authorId: 'u2' },
      { channelId: 'c1', ts: SINCE + MS_PER_DAY, content: 'today' },
      { channelId: 'c2', ts: START, content: 'other', authorId: 'u3' },
    ]);
    const stats = await core.activityStats(CHANNEL);
    expect(stats.comparison).toEqual({ start: START, end: SINCE, totals: {
      messages: 2, authors: 1, activeDays: 2, editedMessages: 1, textMessages: 1, linkedMessages: 1, attachmentMessages: 1,
    } });
    expect([stats.messages, stats.authors, stats.activeDays, stats.textMessages, stats.linkedMessages]).toEqual([3, 2, 2, 2, 1]);
    expect((await core.activityStats({ ...CHANNEL, scope: 'server', guildId: DEFAULT_GUILD.id })).comparison?.totals?.messages).toBe(3);
  });

  it('requires coverage in the same visible scope, including the exact start boundary', async () => {
    const { t, core } = start([
      { channelId: 'hidden', ts: START - 1, content: 'hidden coverage' },
      { channelId: 'c2', ts: START, content: 'other scope coverage' },
      { channelId: 'c1', ts: START + 1, content: 'partial' },
      { channelId: 'c1', ts: SINCE, content: 'now' },
    ]);
    expect((await core.activityStats(CHANNEL)).comparison?.totals).toBeNull();
    t.archive.setPrivacyMode(true);
    expect((await core.activityStats({ ...CHANNEL, scope: 'all' })).comparison?.totals?.messages).toBe(2);
    expect((await core.activityStats({ ...CHANNEL, channelId: 'hidden' })).comparison?.totals).toBeNull();
    t.archive.arrive([{ channelId: 't1', ts: START, content: 'thread coverage' }]);
    expect((await core.activityStats(CHANNEL)).comparison?.totals?.messages).toBe(2);
  });

  it('cannot use a hidden message as the coverage anchor for Everything', async () => {
    const { t, core } = start([
      { channelId: 'hidden', ts: START, content: 'private' },
      { channelId: 'c1', ts: SINCE, content: 'visible' },
    ]);
    t.archive.setPrivacyMode(true);
    expect((await core.activityStats({ ...CHANNEL, scope: 'all' })).comparison?.totals).toBeNull();
    t.archive.setPrivacyMode(false);
    expect((await core.activityStats({ ...CHANNEL, scope: 'all' })).comparison?.totals?.messages).toBe(1);
  });

  it('omits comparison for all archived or invalid spans, and guards empty scopes', async () => {
    const { core } = start([]);
    expect((await core.activityStats(CHANNEL)).comparison).toEqual({ start: START, end: SINCE, totals: null });
    expect((await core.activityStats({ ...CHANNEL, channelId: null })).comparison?.totals).toBeNull();
    expect((await core.activityStats({ ...CHANNEL, sinceTs: null })).comparison).toBeNull();
    expect((await core.activityStats({ ...CHANNEL, sinceTs: NOW })).comparison).toBeNull();
  });

  it('preserves zero earlier headline values for the new label', async () => {
    const { core } = start([
      { channelId: 'c1', ts: START, content: '' },
      { channelId: 'c1', ts: SINCE, content: 'new text https://example.com' },
    ]);
    const stats = await core.activityStats(CHANNEL);
    expect(stats.comparison?.totals?.textMessages).toBe(0);
    expect(comparisonDelta(stats.textMessages, stats.comparison!.totals!.textMessages)).toBe('new');
  });

  it.each([[112, 100, '+12%'], [92, 100, '-8%'], [1, 3, '-67%'], [4, 3, '+33%'], [3, 3, '+0%'], [0, 0, 'new']])
    ('formats whole signed percentages (%s versus %s)', (current, earlier, label) => {
      expect(comparisonDelta(current as number, earlier as number)).toBe(label);
    });
});
