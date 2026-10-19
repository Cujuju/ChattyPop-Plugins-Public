import { domainTree } from './domains';
// Analytics counts over the visible archive; scope metadata and URL shares retain their existing read grants.
import type { ArchiveRead } from '@plugin-sdk/core';
import { POSTERS_PAGE_MAX, POSTERS_TOP, STATS_TOP, type ActivityQuery, type ActivityStats, type PostersQuery, type StatsIdentity, type StatsPoster } from '../shared/types';
import { type StatsSqlScope, type TextQuery } from './query';
import { projectCounts } from './countRead';
import type { StatsRollups } from './rollups';






/** SQL over messages `m`, with the same scope for every summary and poster page. */
export async function scopeSql(read: ArchiveRead, q: TextQuery): Promise<StatsSqlScope> {
  const parts = ['1'];
  const params: (string | number)[] = [];
  if (q.scope === 'channels') {
    parts.push('m.channel_id IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(q.channelIds));
  } else if (q.scope === 'channel' && q.channelId) {
    // One membership range lets SQLite retain channel index order instead of merging two index scans.
    parts.push('m.channel_id IN (SELECT ? UNION ALL SELECT id FROM archive_all_channels WHERE is_thread = 1 AND parent_id = ?)');
    params.push(q.channelId, q.channelId);
  } else if (q.scope === 'server' && q.guildId) {
    parts.push('m.channel_id IN (SELECT id FROM archive_all_channels WHERE guild_id = ?)');
    params.push(q.guildId);
  } else if (q.scope !== 'all') {
    // A channel or server scope without its channel or server counts nothing.
    parts.push('0');
  }
  if (q.sinceTs !== null) {
    parts.push('m.ts >= ?');
    params.push(q.sinceTs);
  }
  if (q.scope === 'channels' && q.untilTs !== null) {
    parts.push('m.ts <= ?');
    params.push(q.untilTs);
  }
  if (q.authorId != null) {
    parts.push('m.author_id = ?');
    params.push(q.authorId);
  }
  return { sql: parts.join(' AND '), params };
}

/** Existing grouped rows can supply identities without another SQL read. */
export function attachPosterIdentities<T extends { userId: string }>(rows: readonly T[], identities: readonly StatsIdentity[]): (T & StatsIdentity)[] {
  const known = new Map<string, StatsIdentity>();
  for (const identity of identities) {
    const previous = known.get(identity.userId);
    if (!previous || identity.name < previous.name) known.set(identity.userId, identity);
  }
  return rows.map((row) => {
    const identity = known.get(row.userId);
    return { ...row, name: identity?.name ?? row.userId, avatar: identity?.avatar ?? null };
  });
}

export async function postersPage(read: ArchiveRead, q: PostersQuery, rollups?: StatsRollups): Promise<StatsPoster[]> {
  if (!Number.isSafeInteger(q.offset) || q.offset < 0 || !Number.isSafeInteger(q.limit) || q.limit <= 0 || q.limit > POSTERS_PAGE_MAX) {
    throw new Error(`Poster pages require a nonnegative offset and a limit from 1 to ${POSTERS_PAGE_MAX}.`);
  }
  return projectCounts(read, q, 'postersPage', rollups);
}

export async function activityStats(read: ArchiveRead, q: ActivityQuery, rollups?: StatsRollups): Promise<ActivityStats> {
  const result = await projectCounts<ActivityStats>(read, q, 'activityStats', rollups);
  return { ...result, domains: domainTree(result.domains as unknown as { url: string; n: number }[]) };
}
