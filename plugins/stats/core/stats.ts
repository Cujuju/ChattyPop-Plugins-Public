// Analytics counts over the visible archive; scope metadata and URL shares retain their existing read grants.
import type { ArchiveRead } from '@plugin-sdk/core';
import { POSTERS_PAGE_MAX, POSTERS_TOP, STATS_TOP, type ActivityQuery, type ActivityStats, type PostersQuery, type StatsIdentity, type StatsPoster } from '../shared/types';
import { type StatsSqlScope, type TextQuery } from './query';
import { totals } from './overview';
import { hourlyHistogram, timeStats } from './histogram';
import { attachmentTypes, editDelay } from './messages';
import { timeline } from './timeline';
import { domainTree } from './domains';
import { periodComparison } from './comparison';

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
  } else if (q.scope === 'server' && q.channelId) {
    const guildId = (await read<{ guild_id: string | null }>('SELECT guild_id FROM archive_all_channels WHERE id = ?', [q.channelId]))[0]?.guild_id;
    // A DM (no server) stands alone.
    if (guildId) {
      parts.push('m.channel_id IN (SELECT id FROM archive_all_channels WHERE guild_id = ?)');
      params.push(guildId);
    } else {
      parts.push('m.channel_id = ?');
      params.push(q.channelId);
    }
  } else if (q.scope !== 'all') {
    // A channel or server scope without an open channel counts nothing.
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

const POSTER_IDENTITY_COLUMNS = 'm.author_id AS userId, MIN(m.author_plain_name) AS name, u.avatar AS avatar';
const POSTER_COLUMNS = `${POSTER_IDENTITY_COLUMNS}, COUNT(*) AS count`;
const CHANNEL_COLUMNS = 'm.channel_id AS channelId, COALESCE(c.name, m.channel_id) AS name, COUNT(*) AS count';
/** URL shares join visible messages, even when the link's first share is hidden. */
export const LINK_SHARES = `FROM archive_all_message_links ml JOIN archive_messages m ON m.id = ml.message_id
  JOIN archive_all_links l ON l.id = ml.link_id`;
/** A link-bearing message counts once, regardless of how many URLs it contains. */
export const LINKED_MESSAGE = 'EXISTS (SELECT 1 FROM archive_all_message_links ml WHERE ml.message_id = m.id)';

/** One scoped read supplies archived identities for all requested users. */
export async function readPosterIdentities(read: ArchiveRead, scope: StatsSqlScope, userIds: readonly string[]): Promise<StatsIdentity[]> {
  const query = posterIdentitiesSql(scope, userIds);
  return query ? (await read(query.sql, [...query.params])) as StatsIdentity[] : [];
}

/** Identities of selected posters within `scope`; null when none are selected. */
export function posterIdentitiesSql(scope: StatsSqlScope, userIds: readonly string[]): { sql: string; params: (string | number)[] } | null {
  const ids = [...new Set(userIds)];
  if (!ids.length) return null;
  return { sql: `SELECT ${POSTER_IDENTITY_COLUMNS}
    FROM archive_messages m LEFT JOIN archive_users u ON u.id = m.author_id
    WHERE ${scope.sql} AND m.author_id IN (${ids.map(() => '?').join(', ')}) GROUP BY m.author_id`, params: [...scope.params, ...ids] };
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

async function posters(read: ArchiveRead, scope: StatsSqlScope, offset: number, limit: number): Promise<StatsPoster[]> {
  return (await read(`SELECT ${POSTER_COLUMNS} FROM archive_messages m LEFT JOIN archive_users u ON u.id = m.author_id
    WHERE ${scope.sql} GROUP BY m.author_id ORDER BY count DESC, userId LIMIT ? OFFSET ?`, [...scope.params, limit, offset])) as StatsPoster[];
}

/** Invalid limits cannot become SQLite's unbounded negative LIMIT. */
export async function postersPage(read: ArchiveRead, q: PostersQuery): Promise<StatsPoster[]> {
  if (!Number.isSafeInteger(q.offset) || q.offset < 0 || !Number.isSafeInteger(q.limit) || q.limit <= 0 || q.limit > POSTERS_PAGE_MAX) {
    throw new Error(`Poster pages require a nonnegative offset and a limit from 1 to ${POSTERS_PAGE_MAX}.`);
  }
  return (await posters(read, (await scopeSql(read, q)), q.offset, q.limit));
}

async function channels(read: ArchiveRead, scope: StatsSqlScope): Promise<ActivityStats['channels']> {
  return (await read(`SELECT ${CHANNEL_COLUMNS} FROM archive_messages m LEFT JOIN archive_all_channels c ON c.id = m.channel_id
    WHERE ${scope.sql} GROUP BY m.channel_id ORDER BY count DESC, channelId LIMIT ?`, [...scope.params, STATS_TOP])) as ActivityStats['channels'];
}

async function links(read: ArchiveRead, scope: StatsSqlScope) {
  const linkedMessages = (await read<{ count: number }>(`SELECT COUNT(DISTINCT m.id) AS count ${LINK_SHARES} WHERE ${scope.sql}`, scope.params))[0]!.count;
  // Host names aren't stored: count shares per URL, then fold by host.
  const byUrl = (await read(`SELECT l.url, COUNT(*) AS n ${LINK_SHARES} WHERE ${scope.sql} GROUP BY l.id`, [...scope.params])) as { url: string; n: number }[];
  const domains = domainTree(byUrl);
  const linksByPerson = (await read(`SELECT ${POSTER_COLUMNS} ${LINK_SHARES} LEFT JOIN archive_users u ON u.id = m.author_id
    WHERE ${scope.sql} GROUP BY m.author_id ORDER BY count DESC, userId LIMIT ?`, [...scope.params, STATS_TOP])) as ActivityStats['linksByPerson'];
  const linksByChannel = (await read(`SELECT ${CHANNEL_COLUMNS} ${LINK_SHARES} LEFT JOIN archive_all_channels c ON c.id = m.channel_id
    WHERE ${scope.sql} GROUP BY m.channel_id ORDER BY count DESC, channelId LIMIT ?`, [...scope.params, STATS_TOP])) as ActivityStats['linksByChannel'];
  return { linkedMessages, domains, linksByPerson, linksByChannel };
}

export async function activityStats(read: ArchiveRead, q: ActivityQuery): Promise<ActivityStats> {
  const now = Date.now();
  const scope = (await scopeSql(read, q));
  const counted = (await totals(read, scope));
  const { firstTs, lastTs, ...overview } = counted;
  const start = firstTs === null ? null : q.sinceTs ?? firstTs;
  const wholeScope = (await scopeSql(read, { ...q, sinceTs: null }));
  const history = (await timeline(read, scope, wholeScope, start, lastTs));
  return {
    query: q,
    ...overview,
    ...timeStats((await hourlyHistogram(read, scope)), start, lastTs),
    posters: (await posters(read, scope, 0, POSTERS_TOP)),
    channels: (await channels(read, scope)),
    editDelay: (await editDelay(read, scope)),
    attachmentTypes: (await attachmentTypes(read, scope)),
    ...(await links(read, scope)),
    ...history,
    comparison: (await periodComparison(read, wholeScope, q.sinceTs, history.archivedSince, now)),
  };
}
