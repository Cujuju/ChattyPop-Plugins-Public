import { channelById, channelLabel, directory } from '@plugin-sdk/renderer/kit';
import type { StatsChannel, StatsScope } from '../shared/types';

/** Everything labels include the directory's server name; missing channels retain their archived name. */
export function statsChannelLabel(channel: StatsChannel, scope: StatsScope): string {
  const known = channelById(channel.channelId);
  if (!known) return channel.name;
  const guildName = scope === 'all'
    ? directory().find((guild) => guild.channels.some((c) => c.id === channel.channelId))?.name
    : undefined;
  return channelLabel(known, guildName);
}
