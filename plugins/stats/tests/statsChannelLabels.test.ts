import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import type { StatsChannel, StatsScope } from '../shared/types';

const env = vi.hoisted(() => ({
  guilds: [
    { name: 'Home', channels: [{ id: 'c1', name: 'general', kind: 0 }] },
    { name: 'Away', channels: [{ id: 'c2', name: 'general', kind: 0 }] },
    { name: 'Direct Messages', channels: [{ id: 'dm', name: 'Alice', kind: 1 }] },
  ],
}));

vi.mock('@plugin-sdk/renderer/kit', () => ({
  directory: () => env.guilds,
  channelById: (id: string) => env.guilds.flatMap((guild) => guild.channels).find((channel) => channel.id === id),
  channelLabel: vi.fn((channel: { name: string; kind: number }, guildName?: string) =>
    `${channel.kind === 1 ? '@' : '#'}${channel.name}${guildName ? ` · ${guildName}` : ''}`),
}));

const labelsPath = '../renderer/channelLabels.ts';
const { statsChannelLabel } = await import(labelsPath) as {
  statsChannelLabel(channel: StatsChannel, scope: StatsScope): string;
};

describe('Analytics channel labels', () => {
  it('distinguishes matching channel names in an Everything scope spanning two servers', async () => {
    const t = testPlugin(statsCore, { archive: {
      guilds: [{ id: 'home', name: 'Home' }, { id: 'away', name: 'Away' }],
      channels: [{ id: 'c1', guildId: 'home', name: 'general' }, { id: 'c2', guildId: 'away', name: 'general' }],
      messages: [{ channelId: 'c1', ts: 0, content: 'hello' }, { channelId: 'c2', ts: 0, content: 'hello' }],
    } });
    onTestFinished(() => t.dispose());
    const stats = await t.client('renderer').activityStats({ scope: 'all', channelId: null, sinceTs: null });
    expect(stats.channels.map((channel) => statsChannelLabel(channel, stats.query.scope))).toEqual(['#general · Home', '#general · Away']);
  });

  it.each(['channel', 'server'] as const)('uses the app label without the server suffix in %s scope', (scope) => {
    expect(statsChannelLabel({ channelId: 'c1', name: 'stored-name', count: 1 }, scope)).toBe('#general');
    expect(statsChannelLabel({ channelId: 'dm', name: 'stored-name', count: 1 }, scope)).toBe('@Alice');
  });

  it('falls back to the stored name when the directory does not know a channel', () => {
    expect(statsChannelLabel({ channelId: 'missing', name: 'stored-name', count: 1 }, 'all')).toBe('stored-name');
  });

  it('reads current directory names on each label access', () => {
    const channel = { channelId: 'c1', name: 'stored-name', count: 1 };
    const guild = env.guilds[0]!;
    const name = guild.name;
    try {
      guild.name = 'Renamed';
      expect(statsChannelLabel(channel, 'all')).toBe('#general · Renamed');
    } finally {
      guild.name = name;
    }
  });
});
