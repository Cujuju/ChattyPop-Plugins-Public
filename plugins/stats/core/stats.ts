// #85 activity stats: counts over the archive in local time. Plain SQL, no AI; privacy mode applies.
import type { ActivityQuery, ActivityStats } from '../shared/types';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { type PluginDb } from '@plugin-sdk/core';

/** Posters and domains listed: a top ten reads at a glance. */
export const STATS_TOP = 10;
/** Spans up to about four months chart one bar per day; longer ones one per week, so bars stay wide enough to read. */
export const DAY_BUCKETS_MAX_DAYS = 120;
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;

/** SQLite time modifiers turning ms column `ts` into local time. */
const local = (ts: string): string => `${ts} / 1000, 'unixepoch', 'localtime'`;

/** SQL (over messages `m`) and params for the query's scope and time range. */
function scopeSql(db: PluginDb, q: ActivityQuery): { sql: string; params: (string | number)[] } {
  const parts = ['1'];
  const params: (string | number)[] = [];
  if (q.scope === 'channel' && q.channelId) {
    const s = { sql: '(m.channel_id = ? OR m.channel_id IN (SELECT id FROM archive_all_channels WHERE is_thread = 1 AND parent_id = ?))', params: [q.channelId, q.channelId] };
    parts.push(s.sql);
    params.push(...s.params);
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
    // A channel or server scope with no channel open counts nothing, not everything.
    parts.push('0');
  }
  if (q.sinceTs !== null) {
    parts.push('m.ts >= ?');
    params.push(q.sinceTs);
  }
  return { sql: parts.join(' AND '), params };
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

export function activityStats(db: PluginDb, q: ActivityQuery): ActivityStats {
  const scope = scopeSql(db, q);
  const where = `WHERE ${scope.sql}`;
  const totals = db.prepare(`SELECT COUNT(*) AS messages, COUNT(DISTINCT m.author_id) AS authors, MIN(m.ts) AS firstTs, MAX(m.ts) AS lastTs FROM archive_messages m ${where}`).get(...scope.params) as {
    messages: number;
    authors: number;
    firstTs: number | null;
    lastTs: number | null;
  };
  // The span the chart covers: from the range start (or first message) to the last message.
  const spanDays = totals.firstTs === null || totals.lastTs === null ? 0 : (totals.lastTs - (q.sinceTs ?? totals.firstTs)) / MS_PER_DAY;
  const bucket = spanDays > DAY_BUCKETS_MAX_DAYS ? 'week' : 'day';
  // A week starts on Monday: step back six days, then forward to the next Monday.
  const startSql = bucket === 'day' ? `date(${local('m.ts')})` : `date(${local('m.ts')}, '-6 days', 'weekday 1')`;
  const buckets = db.prepare(`SELECT ${startSql} AS start, COUNT(*) AS count FROM archive_messages m ${where} GROUP BY start ORDER BY start`).all(...scope.params) as ActivityStats['buckets'];

  const heatmap = Array.from({ length: DAYS_PER_WEEK }, () => new Array<number>(HOURS_PER_DAY).fill(0));
  const cells = db
    .prepare(`SELECT CAST(strftime('%w', ${local('m.ts')}) AS INTEGER) AS wd, CAST(strftime('%H', ${local('m.ts')}) AS INTEGER) AS hr, COUNT(*) AS n FROM archive_messages m ${where} GROUP BY wd, hr`)
    .all(...scope.params) as { wd: number; hr: number; n: number }[];
  for (const c of cells) heatmap[c.wd]![c.hr] = c.n;

  const posters = db
    .prepare(`SELECT m.author_id AS userId, m.author_plain_name AS name, COUNT(*) AS count FROM archive_messages m ${where} GROUP BY m.author_id ORDER BY count DESC LIMIT ?`)
    .all(...scope.params, STATS_TOP) as ActivityStats['posters'];

  // Host names aren't stored, so shares are counted per URL in SQL and folded by host here.
  const byUrl = db.prepare(`SELECT l.url, COUNT(*) AS n FROM archive_all_message_links ml JOIN archive_messages m ON m.id = ml.message_id JOIN archive_all_links l ON l.id = ml.link_id ${where} GROUP BY l.id`).all(...scope.params) as {
    url: string;
    n: number;
  }[];
  const byHost = new Map<string, number>();
  for (const { url, n } of byUrl) {
    const host = hostOf(url);
    if (host) byHost.set(host, (byHost.get(host) ?? 0) + n);
  }
  const domains = [...byHost]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    .slice(0, STATS_TOP);

  return { messages: totals.messages, authors: totals.authors, bucket, buckets, heatmap, posters, domains };
}
