import { describe, expect, it, vi } from 'vitest';
import type { ActivityQuery } from '../shared/types';

const env = vi.hoisted(() => ({
  calls: [] as { member: string; query: ActivityQuery }[],
  events: new Map<string, () => void>(),
  choices: new Map<string, (value: unknown) => void>(),
  pickerIds: ['u1', 'u2'],
  setChannel: (_value: string | null): void => { throw new Error('Channel signal not initialized.'); },
  setCollapsed: (_value: boolean): void => { throw new Error('Collapsed signal not initialized.'); },
}));

vi.mock('solid-js', () => { const client = 'solid-js/dist/solid.js'; return import(client); });
vi.mock('@plugin-sdk/renderer/clients', () => ({
  coreClient: () => new Proxy({}, { get: (_target, member: string) => async (query: ActivityQuery) => {
    env.calls.push({ member, query });
    return member === 'postersPage' ? env.pickerIds.map((userId) => ({ userId, name: userId, avatar: null, count: 1 })) : null;
  } }),
}));
vi.mock('@plugin-sdk/renderer/archiveEvents', () => ({ onArchiveChange: () => () => {} }));
vi.mock('@plugin-sdk/renderer/pluginList', () => ({ callable: () => true }));
vi.mock('@plugin-sdk/renderer', async () => {
  const resourcePath = '@plugin-sdk/renderer/resource';
  const { createSignal } = await import('solid-js');
  return {
    ...(await import('@plugin-sdk/renderer/containment')),
    pluginResource: (await import(resourcePath)).pluginResource,
    pluginData: (await import('@plugin-sdk/renderer/data')).pluginData,
    callable: () => true,
    coreClient: () => ({}),
    onAppEvent: (name: string, handler: () => void) => env.events.set(name, handler),
    pluginPreference: (_plugin: unknown, name: string) => {
      const [value, setValue] = createSignal<unknown>(name === 'place' ? null : name === 'channelsHidden' ? false : name === 'range' ? 'all' : 'overview');
      env.choices.set(name, setValue);
      return [value, setValue];
    },
  };
});
vi.mock('@plugin-sdk/renderer/kit', async () => {
  const { createSignal } = await import('solid-js');
  const [channel, setChannel] = createSignal<string | null>('c1');
  const [collapsed, setCollapsed] = createSignal(false);
  env.setChannel = setChannel;
  env.setCollapsed = setCollapsed;
  return { shownChannelId: channel, isPanelCollapsed: collapsed, directory: () => [], isThread: () => false };
});

const statePath = '../renderer/state.ts';
const state = await import(statePath) as { statsPanelMounted(): () => void; refreshStats(): Promise<void>; statsAuthor(): string | null; setStatsAuthor(value: string | null): void };
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));
const emojiReads = () => env.calls.filter((call) => call.member === 'emojiStats');

describe('Analytics section resources', () => {
  it('uses the SDK resource to gate reads by mounting, folding and the open section, and refetches current choices', async () => {
    await settle();
    expect(env.calls).toEqual([]);
    const unmount = state.statsPanelMounted();
    await settle();
    expect(emojiReads()).toEqual([]);
    env.choices.get('section')!('emoji');
    await settle();
    expect(emojiReads()).toHaveLength(1);
    env.setCollapsed(true);
    await settle();
    await state.refreshStats();
    expect(emojiReads()).toHaveLength(1);
    env.setCollapsed(false);
    await settle();
    expect(emojiReads()).toHaveLength(2);
    env.setChannel('c2');
    await settle();
    expect(emojiReads().at(-1)!.query.channelId).toBe('c2');
    env.choices.get('place')!('all');
    env.choices.get('range')!('7d');
    await settle();
    expect(emojiReads().at(-1)!.query.scope).toBe('all');
    expect(emojiReads().at(-1)!.query.sinceTs).not.toBeNull();
    const beforePrivacy = emojiReads().length;
    env.events.get('privacy-changed')!();
    await settle();
    expect(emojiReads()).toHaveLength(beforePrivacy + 1);
    await state.refreshStats();
    expect(emojiReads()).toHaveLength(beforePrivacy + 2);
    env.choices.get('section')!('words');
    await settle();
    expect(env.calls.filter((call) => call.member === 'wordStats')).toHaveLength(1);
    const beforeWordsRefresh = env.calls.length;
    await state.refreshStats();
    expect(env.calls.slice(beforeWordsRefresh).map((call) => call.member)).toEqual(['activityStats', 'wordStats', 'postersPage']);
    env.choices.get('section')!('sentiment');
    await settle();
    expect(env.calls.filter((call) => call.member === 'sentimentStats')).toHaveLength(1);
    const beforeSentimentRefresh = env.calls.length;
    await state.refreshStats();
    expect(env.calls.slice(beforeSentimentRefresh).map((call) => call.member)).toEqual(['activityStats', 'sentimentStats', 'postersPage']);
    env.choices.get('section')!('conversations');
    await settle();
    expect(env.calls.filter((call) => call.member === 'conversationStats')).toHaveLength(1);
    const beforeConversationsRefresh = env.calls.length;
    await state.refreshStats();
    expect(env.calls.slice(beforeConversationsRefresh).map((call) => call.member)).toEqual(['activityStats', 'conversationStats', 'postersPage']);
    env.choices.get('section')!('people');
    await settle();
    expect(env.calls.filter((call) => call.member === 'peopleStats')).toHaveLength(1);
    expect(env.calls.filter((call) => call.member === 'personHistory' || call.member === 'voiceStats')).toHaveLength(0);
    expect(env.calls.filter((call) => call.member === 'personStreaks')).toHaveLength(0);
    const beforeStreaksRefresh = env.calls.length;
    await state.refreshStats();
    expect(env.calls.slice(beforeStreaksRefresh).map((call) => call.member)).toEqual(['activityStats', 'peopleStats', 'postersPage']);
    env.choices.get('section')!('links');
    await settle();
    expect(env.calls.filter((call) => call.member === 'repeatedLinks')).toHaveLength(1);
    const beforeLinksRefresh = env.calls.length;
    await state.refreshStats();
    expect(env.calls.slice(beforeLinksRefresh).map((call) => call.member)).toEqual(['activityStats', 'repeatedLinks', 'postersPage']);
    env.setCollapsed(true);
    await settle();
    const beforeFoldedRefresh = env.calls.length;
    await state.refreshStats();
    expect(env.calls).toHaveLength(beforeFoldedRefresh);
    env.setCollapsed(false);
    await settle();
    const beforeLinksPrivacy = env.calls.length;
    env.events.get('privacy-changed')!();
    await settle();
    expect(env.calls.slice(beforeLinksPrivacy).map((call) => call.member)).toEqual(['activityStats', 'repeatedLinks', 'postersPage']);
    env.choices.get('section')!('overview');
    await settle();
    await state.refreshStats();
    expect(emojiReads()).toHaveLength(beforePrivacy + 2);
    unmount();
    env.choices.get('section')!('emoji');
    await settle();
    expect(emojiReads()).toHaveLength(beforePrivacy + 2);
  });

  it('wires the session author into every section, refresh, picker fallback and place resets', async () => {
    const unmount = state.statsPanelMounted();
    env.choices.get('place')!('all');
    env.choices.get('range')!('all');
    await settle();
    state.setStatsAuthor('u1');
    await settle();
    for (const [section, member] of [['emoji', 'emojiStats'], ['words', 'wordStats'], ['sentiment', 'sentimentStats'], ['conversations', 'conversationStats'], ['people', 'peopleStats'], ['links', 'repeatedLinks']]) {
      env.choices.get('section')!(section!);
      await settle();
      expect(env.calls.filter((call) => call.member === member).at(-1)?.query.authorId).toBe('u1');
    }
    await state.refreshStats();
    expect(env.calls.filter((call) => call.member === 'activityStats').at(-1)?.query.authorId).toBe('u1');
    expect(env.calls.filter((call) => call.member === 'postersPage').every((call) => call.query.authorId === null)).toBe(true);
    env.setChannel('c3');
    await settle();
    expect(state.statsAuthor()).toBe('u1');
    env.choices.get('place')!({ by: 'guild', id: 'g1' });
    await settle();
    expect(state.statsAuthor()).toBeNull();
    state.setStatsAuthor('u1');
    // A picked place stays put as the Archive moves.
    env.setChannel('c4');
    await settle();
    expect(state.statsAuthor()).toBe('u1');
    // Unpicked, the place is the open channel, and follows it.
    env.choices.get('place')!(null);
    await settle();
    expect(state.statsAuthor()).toBeNull();
    state.setStatsAuthor('u1');
    env.setChannel(null);
    await settle();
    expect(state.statsAuthor()).toBeNull();
    state.setStatsAuthor('u1');
    env.pickerIds = ['u2'];
    env.choices.get('range')!('7d');
    await settle();
    expect(state.statsAuthor()).toBeNull();
    env.pickerIds = ['u1', 'u2'];
    unmount();
  });
});
