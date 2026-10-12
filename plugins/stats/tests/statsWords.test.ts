import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { CLOUD_WORDS } from '../shared/text';
import { cloudInputs, CLOUD_FONT_MIN, CLOUD_FONT_MAX } from '../renderer/cloudInputs';

const CHANNEL = { scope: 'channel', channelId: 'c1', sinceTs: null } as const;

function start() {
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages: [
    { channelId: 'c1', ts: 0, content: 'PIZZA pizza and tasty! https://example.com/Secret <@123> <:wave:456> ```omitted words```' },
    { channelId: 't1', ts: 1, content: 'pizza cat we go' },
    { channelId: 'c1', ts: 2, content: '' },
    { channelId: 'c2', ts: 3, content: 'tasty' },
    { channelId: 'hidden', ts: 4, content: 'secret' },
  ] } });
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}

describe('Analytics words', () => {
  it('reports all token totals while filtering English stop words and short fragments from rankings', async () => {
    const stats = await start().core.wordStats(CHANNEL);
    expect([stats.textMessages, stats.totalWords, stats.uniqueWords, stats.wordsPerMessage]).toEqual([2, 8, 6, 4]);
    expect(stats.words).toEqual([{ word: 'pizza', count: 3 }, { word: 'cat', count: 1 }, { word: 'tasty', count: 1 }]);
  });

  it('honors range, scope and privacy, including retained messages with no word-like content', async () => {
    const { t, core } = start();
    expect((await core.wordStats({ ...CHANNEL, sinceTs: 1 })).words).toEqual([{ word: 'cat', count: 1 }, { word: 'pizza', count: 1 }]);
    expect((await core.wordStats({ ...CHANNEL, scope: 'server' })).textMessages).toBe(4);
    t.archive.setPrivacyMode(true);
    const visible = await core.wordStats({ scope: 'all', channelId: null, sinceTs: null });
    expect(visible.words.some((word) => word.word === 'secret')).toBe(false);
    expect(visible.textMessages).toBe(3);
    const empty = await core.wordStats({ ...CHANNEL, channelId: null });
    expect([empty.textMessages, empty.totalWords, empty.uniqueWords, empty.wordsPerMessage, empty.words]).toEqual([0, 0, 0, 0, []]);
    t.archive.arrive([{ channelId: 'c1', ts: 5, content: '😀 https://example.com' }]);
    const emojiOnly = await core.wordStats({ ...CHANNEL, sinceTs: 5 });
    expect([emojiOnly.textMessages, emojiOnly.totalWords, emojiOnly.wordsPerMessage]).toEqual([1, 0, 0]);
  });

  it('converts counts to bounded cloud inputs without mutating the ranked source', () => {
    const words = [{ word: 'small', count: 1 }, { word: 'big', count: 4 }, { word: 'zero', count: 0 }];
    const copy = structuredClone(words);
    const inputs = cloudInputs(words);
    expect(inputs.map((word) => [word.text, word.share])).toEqual([['big', 1], ['small', 0.25]]);
    expect(inputs[0]!.size).toBe(CLOUD_FONT_MAX);
    expect(inputs[1]!.size).toBe(CLOUD_FONT_MIN + (CLOUD_FONT_MAX - CLOUD_FONT_MIN) / 2);
    expect(words).toEqual(copy);
    expect(cloudInputs([])).toEqual([]);
    expect(cloudInputs(Array.from({ length: CLOUD_WORDS + 1 }, (_, index) => ({ word: `word${index}`, count: 1 })))).toHaveLength(CLOUD_WORDS);
  });
});
