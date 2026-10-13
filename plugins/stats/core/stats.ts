// Analytics counts over the visible archive; scope metadata and URL shares retain their existing read grants.
import type { PluginDb } from '@plugin-sdk/core';
import { POSTERS_PAGE_MAX, POSTERS_TOP, STATS_TOP, type ActivityQuery, type ActivityStats, type PostersQuery, type StatsIdentity, type StatsPoster } from '../shared/types';
import { type StatsSqlScope } from './query';
import { totals } from './overview';
import { hourlyHistogram, timeStats } from './histogram';
import { attachmentTypes, editDelay } from './messages';
import { timeline } from './timeline';
import { domainTree } from './domains';
import { periodComparison } from './comparison';

/** SQL over messages `m`, with the same scope for every summary and poster page. */
export function scopeSql(db: PluginDb, q: ActivityQuery): StatsSqlScope {
  const parts = ['1'];
  const params: (string | number)[] = [];
  if (q.scope === 'channel' && q.channelId) {
    // One membership range lets SQLite retain channel index order instead of merging two index scans.
    parts.push('m.channel_id IN (SELECT ? UNION ALL SELECT id FROM archive_all_channels WHERE is_thread = 1 AND parent_id = ?)');
    params.push(q.channelId, q.channelId);
  } else if (q.scope === 'server' && q.channelId) {
    const guildId = db.prepare('SELECT guild_id FROM archive_all_channels WHERE id = ?').pluck().get(q.channelId) as string | null | undefined;
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
export function readPosterIdentities(db: PluginDb, scope: StatsSqlScope, userIds: readonly string[]): StatsIdentity[] {
  const ids = [...new Set(userIds)];
  if (!ids.length) return [];
  return db.prepare(`SELECT ${POSTER_IDENTITY_COLUMNS}
    FROM archive_messages m LEFT JOIN archive_users u ON u.id = m.author_id
    WHERE ${scope.sql} AND m.author_id IN (${ids.map(() => '?').join(', ')}) GROUP BY m.author_id`)
    .all(...scope.params, ...ids) as StatsIdentity[];
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

function posters(db: PluginDb, scope: StatsSqlScope, offset: number, limit: number): StatsPoster[] {
  return db.prepare(`SELECT ${POSTER_COLUMNS} FROM archive_messages m LEFT JOIN archive_users u ON u.id = m.author_id
    WHERE ${scope.sql} GROUP BY m.author_id ORDER BY count DESC, userId LIMIT ? OFFSET ?`)
    .all(...scope.params, limit, offset) as StatsPoster[];
}

/** Invalid limits cannot become SQLite's unbounded negative LIMIT. */
export function postersPage(db: PluginDb, q: PostersQuery): StatsPoster[] {
  if (!Number.isSafeInteger(q.offset) || q.offset < 0 || !Number.isSafeInteger(q.limit) || q.limit <= 0 || q.limit > POSTERS_PAGE_MAX) {
    throw new Error(`Poster pages require a nonnegative offset and a limit from 1 to ${POSTERS_PAGE_MAX}.`);
  }
  return posters(db, scopeSql(db, q), q.offset, q.limit);
}

function channels(db: PluginDb, scope: StatsSqlScope): ActivityStats['channels'] {
  return db.prepare(`SELECT ${CHANNEL_COLUMNS} FROM archive_messages m LEFT JOIN archive_all_channels c ON c.id = m.channel_id
    WHERE ${scope.sql} GROUP BY m.channel_id ORDER BY count DESC, channelId LIMIT ?`)
    .all(...scope.params, STATS_TOP) as ActivityStats['channels'];
}

function links(db: PluginDb, scope: StatsSqlScope) {
  const linkedMessages = db.prepare(`SELECT COUNT(DISTINCT m.id) ${LINK_SHARES} WHERE ${scope.sql}`)
    .pluck().get(...scope.params) as number;
  // Host names aren't stored: count shares per URL, then fold by host.
  const byUrl = db.prepare(`SELECT l.url, COUNT(*) AS n ${LINK_SHARES} WHERE ${scope.sql} GROUP BY l.id`)
    .all(...scope.params) as { url: string; n: number }[];
  const domains = domainTree(byUrl);
  const linksByPerson = db.prepare(`SELECT ${POSTER_COLUMNS} ${LINK_SHARES} LEFT JOIN archive_users u ON u.id = m.author_id
    WHERE ${scope.sql} GROUP BY m.author_id ORDER BY count DESC, userId LIMIT ?`)
    .all(...scope.params, STATS_TOP) as ActivityStats['linksByPerson'];
  const linksByChannel = db.prepare(`SELECT ${CHANNEL_COLUMNS} ${LINK_SHARES} LEFT JOIN archive_all_channels c ON c.id = m.channel_id
    WHERE ${scope.sql} GROUP BY m.channel_id ORDER BY count DESC, channelId LIMIT ?`)
    .all(...scope.params, STATS_TOP) as ActivityStats['linksByChannel'];
  return { linkedMessages, domains, linksByPerson, linksByChannel };
}

export function activityStats(db: PluginDb, q: ActivityQuery): ActivityStats {
  const now = Date.now();
  const scope = scopeSql(db, q);
  const counted = totals(db, scope);
  const { firstTs, lastTs, ...overview } = counted;
  const start = firstTs === null ? null : q.sinceTs ?? firstTs;
  const wholeScope = scopeSql(db, { ...q, sinceTs: null });
  const history = timeline(db, scope, wholeScope, start, lastTs);
  return {
    query: q,
    ...overview,
    ...timeStats(hourlyHistogram(db, scope), start, lastTs),
    posters: posters(db, scope, 0, POSTERS_TOP),
    channels: channels(db, scope),
    editDelay: editDelay(db, scope),
    attachmentTypes: attachmentTypes(db, scope),
    ...links(db, scope),
    ...history,
    comparison: periodComparison(db, wholeScope, q.sinceTs, history.archivedSince, now),
  };
}
