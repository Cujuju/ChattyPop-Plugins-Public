// The Links feed: shared links from the host's link index, with Jev's judgments and each link's best preview card.
import type { ArchiveEmbed, ArchiveMessage, Platform } from '@plugin-sdk/shared';
import { embedsFrom, normalizeUrl, type PluginDb, type ArchivePayloadReader } from '@plugin-sdk/core';
import type { LinkFilter, LinkItem, LinkPageQuery } from '../shared/types';
import { FLAG_AT } from './judge';
import { JUDGMENTS } from './tables';

/**
 * WHERE clause and params for a filter; `l` is the links table. Privacy mode hides a link whose first share it hides, or
 * that points into a hidden channel or server.
 */
function where(f: LinkFilter): { sql: string; params: (string | number)[] } {
  const parts: string[] = ['1'];
  const params: (string | number)[] = [];
  if (f.platforms?.length) {
    parts.push(`l.platform IN (${f.platforms.map(() => '?').join(',')})`);
    params.push(...f.platforms);
  }
  if (f.channelId) {
    const scope = { sql: '(l.first_channel_id = ? OR l.first_channel_id IN (SELECT id FROM archive_all_channels WHERE is_thread = 1 AND parent_id = ?))', params: [f.channelId, f.channelId] };
    parts.push(scope.sql);
    params.push(...scope.params);
  }
  if (f.sinceTs !== undefined) {
    parts.push('l.first_ts > ?');
    params.push(f.sinceTs);
  }
  if (f.untilTs !== undefined) {
    parts.push('l.first_ts <= ?');
    params.push(f.untilTs);
  }
  if (f.hideFlagged) {
    parts.push(`NOT EXISTS (SELECT 1 FROM ${JUDGMENTS} j WHERE j.url = l.url AND j.flagged >= ?)`);
    params.push(FLAG_AT);
  }
  return { sql: parts.join(' AND '), params };
}

type LinkRow = Omit<LinkItem, 'embed' | 'flagged' | 'message'> & { flagged: number | null };

/** Sort key for worth: unjudged links sort below every judged one. */
const UNJUDGED_WORTH = -1;
const WORTH_KEY = `COALESCE(j.worth, ${UNJUDGED_WORTH})`;

interface Share {
  messageId: string;
  embedsJson: string | null;
  bot: number | null;
}

/** A share's embed for this link: its first embed whose URL normalizes to the link. */
const shareEmbed = (r: LinkRow, s: Share): ArchiveEmbed | undefined => embedsFrom(s.embedsJson).find((e) => e.url !== null && normalizeUrl(e.url) === r.url);

/**
 * The link's preview card and the share it came from. A bot's share comes first: an embed fixer reposts a link to give
 * it a fuller card than Discord's own unfurl. Then the earliest share that has one; then the unfurl fields stored on
 * the link (source null).
 */
function embedFor(r: LinkRow, shares: Share[]): { embed: ArchiveEmbed | null; source: string | null } {
  for (const s of [...shares.filter((x) => x.bot), ...shares.filter((x) => !x.bot)]) {
    const own = shareEmbed(r, s);
    if (own) return { embed: own, source: s.messageId };
  }
  if (!r.title && !r.description && !r.thumbnailUrl) return { embed: null, source: null };
  return { source: null, embed: {
    type: 'link',
    url: r.url,
    title: r.title,
    description: r.description,
    color: null,
    provider: r.site,
    author: null,
    thumbnailUrl: r.thumbnailUrl,
    thumbnailSize: null,
    imageUrl: null,
    imageSize: null,
    videoUrl: null,
    videoSize: null,
    footer: null,
  } };
}

/**
 * Links newest first (by first share), or most worth reading first (#63); keyset-paged either way. `messagesByIds`: the
 * sharing messages as the Archive shows them (privacy mode applied).
 */
export function linkPage(db: PluginDb, payloads: ArchivePayloadReader, messagesByIds: (ids: string[]) => ArchiveMessage[], q: LinkPageQuery): LinkItem[] {
  const w = where(q);
  const byWorth = q.sort === 'worth';
  // Row values compare key by key, matching the ORDER BY (every key descending, none NULL).
  const cursor = !q.after ? '' : byWorth ? ` AND (${WORTH_KEY}, l.first_ts, l.id) < (?, ?, ?)` : ' AND (l.first_ts, l.id) < (?, ?)';
  const cursorParams = !q.after ? [] : byWorth ? [q.after.worth ?? UNJUDGED_WORTH, q.after.ts, q.after.id] : [q.after.ts, q.after.id];
  const rows = db
    .prepare(
      `SELECT l.id, l.url, l.platform, l.title, l.description, l.thumbnail_url AS thumbnailUrl, l.site, l.first_ts AS ts, l.first_message_id AS messageId,
              l.first_channel_id AS channelId, COALESCE(c.name, l.first_channel_id) AS channelName, COALESCE(g.name, '') AS guildName,
              l.author_name AS authorName,
              (SELECT COUNT(*) FROM archive_all_message_links ml WHERE ml.link_id = l.id) AS shares,
              j.category, j.flagged, j.worth
       FROM archive_links l
       LEFT JOIN ${JUDGMENTS} j ON j.url = l.url
       LEFT JOIN archive_all_channels c ON c.id = l.first_channel_id
       LEFT JOIN archive_all_guilds g ON g.id = c.guild_id
       WHERE ${w.sql}${cursor}
       ORDER BY ${byWorth ? `${WORTH_KEY} DESC, ` : ''}l.first_ts DESC, l.id DESC LIMIT ?`,
    )
    .all(...w.params, ...cursorParams, q.limit) as LinkRow[];
  const shares = new Map<number, Share[]>();
  if (rows.length) {
    const all = db
      .prepare(
        `SELECT ml.link_id AS linkId, m.id AS messageId, m.id AS payloadId
         FROM archive_all_message_links ml JOIN archive_all_messages m ON m.id = ml.message_id
         WHERE ml.link_id IN (${rows.map(() => '?').join(',')}) ORDER BY m.ts`,
      )
      .all(...rows.map((r) => r.id)) as { linkId: number; messageId: string; payloadId: string }[];
    const details = payloads(all.map((s) => s.payloadId));
    for (const s of all) shares.set(s.linkId, [...(shares.get(s.linkId) ?? []), { messageId: s.messageId, embedsJson: details.get(s.payloadId)?.embedsJson ?? null, bot: details.get(s.payloadId)?.bot ?? null }]);
  }
  const messages = new Map(messagesByIds([...new Set(rows.map((r) => r.messageId))]).map((m) => [m.id, m]));
  return rows.map((r) => {
    const { embed, source } = embedFor(r, shares.get(r.id) ?? []);
    const m = messages.get(r.messageId) ?? null;
    // A card from another share (an embed fixer's) replaces the first message's own card for this link.
    const message = m && source && source !== m.id ? { ...m, embeds: m.embeds.filter((e) => e.url === null || normalizeUrl(e.url) !== r.url) } : m;
    return { ...r, flagged: (r.flagged ?? 0) >= FLAG_AT, embed, message };
  });
}

/** Link counts per platform for a filter (platform filter ignored so every chip shows its count). */
export function linkCounts(db: PluginDb, f: LinkFilter): Partial<Record<Platform, number>> {
  const w = where({ ...f, platforms: undefined });
  const rows = db.prepare(`SELECT l.platform, COUNT(*) AS n FROM archive_links l WHERE ${w.sql} GROUP BY l.platform`).all(...w.params) as {
    platform: Platform;
    n: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.platform, r.n]));
}
