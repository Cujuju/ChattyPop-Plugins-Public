import { statementRead } from '@chattypop/host-testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin, type SeedArchive } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { wordStats } from '../core/words';
import { WORD_TREND_MIN_USES, WORD_TREND_TOP, wordStrip } from '../shared/wordTrends';

const CHANNEL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;
const at = (day: number) => new Date(2026, 0, day).getTime();
const uses = (word: string, n: number) => Array(n).fill(word).join(' ');
function start(messages: SeedArchive['messages']) {
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages } });
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}

describe('Analytics word trends', () => {
  it('compares rates using all words, filters rare words and keeps one-half words and chosen strips', async () => {
    const { t } = start([
      { channelId: 't1', ts: at(3), content: `${uses('pizza', 5)} ${uses('bagel', 10)} ${uses('and', 9)}` },
      { channelId: 'c1', ts: at(1), content: `${uses('pizza', 5)} ${uses('toast', 5)} ${uses('and', 10)} ${uses('scone', WORD_TREND_MIN_USES - 1)}` },
      { channelId: 'c1', ts: at(100), content: ' \t\n' },
    ]);
    const prepare = vi.spyOn(t.db, 'prepare');
    const stats = await wordStats(statementRead(t.db), CHANNEL);
    expect(stats.trends.midpointTs).toBe(at(2));
    expect([stats.trends.earlierWords, stats.trends.laterWords]).toEqual([24, 24]);
    expect(stats.trends.rising).toEqual([{ word: 'bagel', earlierRate: 0, laterRate: 10000 / 24 }]);
    expect(stats.trends.fading).toEqual([{ word: 'toast', earlierRate: 5000 / 24, laterRate: 0 }]);
    expect(stats.trends.choices[0]).toBe(stats.words[0]!.word);
    expect(stats.trends.choices).toEqual(['bagel', 'pizza', 'toast', 'scone']);
    expect(stats.trends.buckets.map((b) => [b.start, b.totalWords])).toEqual([['2026-01-01', 24], ['2026-01-02', 0], ['2026-01-03', 24]]);
    expect(wordStrip(stats.trends.buckets, 'bagel')).toEqual([0, 0, 10000 / 24]);
    expect(wordStrip(stats.trends.buckets, 'toast')).toEqual([5000 / 24, 0, 0]);
    expect(wordStrip(stats.trends.buckets, 'pizza')).toEqual([5000 / 24, 0, 5000 / 24]);
  });

  it('assigns midpoint messages to the later half and handles an empty half without infinite rates', async () => {
    const { core } = start([
      { channelId: 'c1', ts: at(1), content: 'https://example.com' },
      { channelId: 'c1', ts: at(2), content: uses('bagel', WORD_TREND_MIN_USES) },
      { channelId: 'c1', ts: at(3), content: '😀' },
    ]);
    const stats = await core.wordStats(CHANNEL);
    expect([stats.trends.midpointTs, stats.trends.earlierWords, stats.trends.laterWords]).toEqual([at(2), 0, WORD_TREND_MIN_USES]);
    expect(stats.trends.rising).toEqual([{ word: 'bagel', earlierRate: 0, laterRate: 1000 }]);
    const same = await start([{ channelId: 'c1', ts: at(1), content: uses('toast', WORD_TREND_MIN_USES) }]).core.wordStats(CHANNEL);
    expect(same.trends.rising).toEqual([{ word: 'toast', earlierRate: 0, laterRate: 1000 }]);
  });

  it('bounds rankings, orders ties by word and includes trends outside the top ten choices', async () => {
    const early = Array.from({ length: WORD_TREND_TOP + 2 }, (_, i) => `earlyword${String.fromCharCode(97 + i)}`);
    const late = Array.from({ length: WORD_TREND_TOP + 2 }, (_, i) => `lateword${String.fromCharCode(97 + i)}`);
    const { core } = start([
      { channelId: 'c1', ts: at(1), content: early.map((word) => uses(word, WORD_TREND_MIN_USES)).join(' ') },
      { channelId: 'c1', ts: at(3), content: late.map((word) => uses(word, WORD_TREND_MIN_USES)).join(' ') },
    ]);
    const stats = await core.wordStats(CHANNEL);
    expect(stats.trends.rising.map((w) => w.word)).toEqual(late.slice(0, WORD_TREND_TOP));
    expect(stats.trends.fading.map((w) => w.word)).toEqual(early.slice(0, WORD_TREND_TOP));
    expect(stats.trends.choices).toEqual([...early.slice(0, WORD_TREND_TOP), ...late.slice(0, WORD_TREND_TOP)]);
    expect(stats.trends.buckets.every((b) => Object.keys(b.counts).length === stats.trends.choices.length)).toBe(true);
  });

  it('shares the weekly rule, applies scope and privacy and returns complete empty trends', async () => {
    const { t, core } = start([
      { channelId: 'c1', ts: at(1), content: uses('pizza', WORD_TREND_MIN_USES) },
      { channelId: 't1', ts: at(200), content: uses('bagel', WORD_TREND_MIN_USES) },
      { channelId: 'c2', ts: at(200), content: uses('toast', WORD_TREND_MIN_USES) },
      { channelId: 'hidden', ts: at(300), content: uses('private', WORD_TREND_MIN_USES) },
    ]);
    const stats = await core.wordStats(CHANNEL);
    expect(stats.trends.bucket).toBe((await core.activityStats(CHANNEL)).bucket);
    expect(stats.trends.buckets.slice(1, -1).every((b) => b.totalWords === 0)).toBe(true);
    expect((await core.wordStats({ ...CHANNEL, sinceTs: at(200) })).trends.fading).toEqual([]);
    t.archive.setPrivacyMode(true);
    expect((await core.wordStats({ ...CHANNEL, scope: 'server' })).trends.choices).not.toContain('private');
    for (const query of [{ ...CHANNEL, channelId: null }, { ...CHANNEL, sinceTs: at(301) }]) {
      expect((await core.wordStats(query)).trends).toEqual({ midpointTs: null, earlierWords: 0, laterWords: 0, rising: [], fading: [], choices: [], bucket: 'day', buckets: [] });
    }
    expect((await start([]).core.wordStats(CHANNEL)).trends.choices).toEqual([]);
  });
});
