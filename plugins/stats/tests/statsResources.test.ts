import { describe, expect, it, vi } from 'vitest';
import type { ActivityQuery } from '../shared/types';

const env = vi.hoisted(() => ({
  calls: [] as { member: string; query: ActivityQuery }[],
  events: new Map<string, () => void>(),
  choices: new Map<string, (value: string) => void>(),
  setChannel: (_value: string | null): void => { throw new Error('Channel signal not initialized.'); },
  setCollapsed: (_value: boolean): void => { throw new Error('Collapsed signal not initialized.'); },
}));

vi.mock('solid-js', () => { const client = 'solid-js/dist/solid.js'; return import(client); });
vi.mock('@plugin-sdk/renderer/clients', () => ({
  coreClient: () => new Proxy({}, { get: (_target, member: string) => async (query: ActivityQuery) => {
    env.calls.push({ member, query });
    return null;
  } }),
}));
vi.mock('@plugin-sdk/renderer/pluginList', () => ({ callable: () => true }));
vi.mock('@plugin-sdk/renderer', async () => {
  const resourcePath = '@plugin-sdk/renderer/resource';
  const { createSignal } = await import('solid-js');
  return {
    pluginResource: (await import(resourcePath)).pluginResource,
    pluginData: (await import('@plugin-sdk/renderer/data')).pluginData,
    callable: () => true,
    coreClient: () => ({}),
    onAppEvent: (name: string, handler: () => void) => env.events.set(name, handler),
    pluginPreference: (_plugin: unknown, name: string) => {
      const [value, setValue] = createSignal(name === 'scope' ? 'channel' : name === 'range' ? 'all' : 'overview');
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
  return { shownChannelId: channel, isPanelCollapsed: collapsed };
});

const statePath = '../renderer/state.ts';
const state = await import(statePath) as { statsPanelMounted(): () => void; refreshStats(): Promise<void> };
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
    env.choices.get('scope')!('all');
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
    env.choices.get('section')!('overview');
    await settle();
    await state.refreshStats();
    expect(emojiReads()).toHaveLength(beforePrivacy + 2);
    unmount();
    env.choices.get('section')!('emoji');
    await settle();
    expect(emojiReads()).toHaveLength(beforePrivacy + 2);
  });
});
