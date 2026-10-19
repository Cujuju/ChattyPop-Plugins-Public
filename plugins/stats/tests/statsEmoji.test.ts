import { describe, expect, it, onTestFinished } from 'vitest';
import { DEFAULT_GUILD, testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { FALLBACK_EMOJI } from '../core/emoji';

const ALL = { scope: 'all', channelId: null, sinceTs: null } as const;

function start() {
  const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }, { id: 't1', parentId: 'c1' }, { id: 'c2' }, { id: 'hidden', hidden: true }], messages: [
    { channelId: 'c1', ts: 0, content: '<:wave:123> <:wave:123> 👨‍👩‍👧‍👦 👍🏽 🇬🇧 1️⃣' },
    { channelId: 't1', ts: 1, content: '<a:dance:456> 👍🏽' },
    { channelId: 'c1', ts: 2, content: ' \n\t ' },
    { channelId: 'c2', ts: 3, content: '😀' },
    { channelId: 'hidden', ts: 4, content: '<:secret:789> 😀' },
  ] } });
  onTestFinished(() => t.dispose());
  return { t, core: t.client('renderer') };
}

describe('Analytics emoji', () => {
  it('counts custom ids and whole Unicode sequences with retained-text coverage', async () => {
    const stats = await start().core.emojiStats({ scope: 'channel', channelId: 'c1', sinceTs: null });
    expect([stats.textMessages, stats.custom, stats.unicode, stats.unicodeMatcher]).toEqual([2, 3, 5, 'RGI_Emoji']);
    expect(stats.emoji.find((emoji) => emoji.id === '123')).toEqual({ id: '123', name: 'wave', animated: false, count: 2 });
    expect(stats.emoji.find((emoji) => emoji.id === '456')).toEqual({ id: '456', name: 'dance', animated: true, count: 1 });
    expect(stats.emoji.find((emoji) => emoji.name === '👍🏽')?.count).toBe(2);
    for (const name of ['👨‍👩‍👧‍👦', '🇬🇧', '1️⃣']) expect(stats.emoji.find((emoji) => emoji.name === name)?.count).toBe(1);
  });

  it('honors ranges, server scopes, absent channels and privacy', async () => {
    const { t, core } = start();
    const ranged = await core.emojiStats({ scope: 'channel', channelId: 'c1', sinceTs: 1 });
    expect([ranged.textMessages, ranged.custom, ranged.unicode]).toEqual([1, 1, 1]);
    expect((await core.emojiStats({ scope: 'server', channelId: null, guildId: DEFAULT_GUILD.id, sinceTs: null })).textMessages).toBe(4);
    expect((await core.emojiStats({ ...ALL, scope: 'channel' })).textMessages).toBe(0);
    t.archive.setPrivacyMode(true);
    const visible = await core.emojiStats(ALL);
    expect([visible.textMessages, visible.custom, visible.unicode]).toEqual([3, 3, 6]);
    expect(visible.emoji.some((emoji) => emoji.id === '789')).toBe(false);
  });

  it('keeps modifiers, joined pictographs, flags and keycaps whole in the fallback', () => {
    expect([...'👨‍👩‍👧‍👦 🇬🇧 👍🏽 1️⃣'.matchAll(FALLBACK_EMOJI)].map((match) => match[0])).toEqual(['👨‍👩‍👧‍👦', '🇬🇧', '👍🏽', '1️⃣']);
  });
});
