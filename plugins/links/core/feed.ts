// The Links feed: shared links from the host's link index, with Jev's judgments and each link's best preview card.
import type { ArchiveEmbed, ArchiveMessage, Platform } from '@plugin-sdk/shared';
import { embedsFrom, normalizeUrl, partKey, type PluginDb, type ArchivePayloadReader } from '@plugin-sdk/core';
import type { LinkCard, LinkCursor, LinkFilter, LinkItem, LinkPageQuery, LinkSort, LinkWindow, LinkWindowQuery, PersonLinksQuery } from '../shared/types';
import { FLAG_AT } from './judge';
import { JUDGMENTS } from './tables';

/** Builds filter SQL and parameters; l aliases links. Privacy hides links with hidden first shares or hidden channel/server destinations. */
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

type LinkRow = Omit<LinkCard, 'embed' | 'flagged'> & { flagged: number | null };

/** What a row reads of the link itself and its judgment; `l` is archive_links, `j` its judgment. */
const LINK_COLUMNS = `l.id, l.url, l.platform, l.title, l.description, l.thumbnail_url AS thumbnailUrl, l.site,
              (SELECT COUNT(*) FROM archive_all_message_links ml WHERE ml.link_id = l.id) AS shares,
              j.category, j.flagged, j.worth`;

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

/** Chooses preview cards from bot shares first, then the earliest share with an embed, then stored unfurl fields with null source. */
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

/** Rows past a cursor in sort order: after it (`<`, older), from it (`<=`, it included), or before it (`>`, newer). */
type Past = { cursor: LinkCursor; op: '<' | '<=' | '>' };

/** Up to `limit` rows in sort order (every key descending); past a cursor, the nearest ones to it. */
function linkRows(db: PluginDb, f: LinkFilter, sort: LinkSort | undefined, past: Past | null, limit: number): LinkRow[] {
  const w = where(f);
  const byWorth = sort === 'worth';
  // Row values compare key by key, matching the ORDER BY (none NULL).
  const cursor = !past ? '' : byWorth ? ` AND (${WORTH_KEY}, l.first_ts, l.id) ${past.op} (?, ?, ?)` : ` AND (l.first_ts, l.id) ${past.op} (?, ?)`;
  const cursorParams = !past ? [] : byWorth ? [past.cursor.worth ?? UNJUDGED_WORTH, past.cursor.ts, past.cursor.id] : [past.cursor.ts, past.cursor.id];
  // Newer rows nearest the cursor come first ascending, then turn back into sort order.
  const dir = past?.op === '>' ? 'ASC' : 'DESC';
  const rows = db
    .prepare(
      `SELECT ${LINK_COLUMNS}, l.first_ts AS ts, l.first_message_id AS messageId,
              l.first_channel_id AS channelId, COALESCE(c.name, l.first_channel_id) AS channelName, COALESCE(g.name, '') AS guildName,
              l.author_name AS authorName
       FROM archive_links l
       LEFT JOIN ${JUDGMENTS} j ON j.url = l.url
       LEFT JOIN archive_all_channels c ON c.id = l.first_channel_id
       LEFT JOIN archive_all_guilds g ON g.id = c.guild_id
       WHERE ${w.sql}${cursor}
       ORDER BY ${byWorth ? `${WORTH_KEY} ${dir}, ` : ''}l.first_ts ${dir}, l.id ${dir} LIMIT ?`,
    )
    .all(...w.params, ...cursorParams, limit) as LinkRow[];
  return dir === 'ASC' ? rows.reverse() : rows;
}

/** Keyset-paged links sorted newest or most worthwhile (#63), with privacy-filtered sharing messages. */
export function linkPage(db: PluginDb, payloads: ArchivePayloadReader, messagesByIds: (ids: string[]) => ArchiveMessage[], q: LinkPageQuery): LinkItem[] {
  const past: Past | null = q.before ? { cursor: q.before, op: '>' } : q.after ? { cursor: q.after, op: '<' } : null;
  return itemsOf(db, payloads, messagesByIds, linkRows(db, q, q.sort, past, q.limit));
}

/** Links around a cursor in sort order: up to `newer` before it, then up to `older` from it (it included). */
export function linkWindow(db: PluginDb, payloads: ArchivePayloadReader, messagesByIds: (ids: string[]) => ArchiveMessage[], q: LinkWindowQuery): LinkWindow {
  // One beyond each side tells whether that side reaches its end.
  const newer = linkRows(db, q, q.sort, { cursor: q.around, op: '>' }, q.newer + 1);
  const older = linkRows(db, q, q.sort, { cursor: q.around, op: '<=' }, q.older + 1);
  const newerKept = newer.slice(Math.max(0, newer.length - q.newer));
  const olderKept = older.slice(0, q.older);
  return {
    items: itemsOf(db, payloads, messagesByIds, [...newerKept, ...olderKept]),
    reachesNewest: newer.length <= q.newer,
    reachedStart: older.length <= q.older,
    anchorId: (olderKept[0] ?? newerKept.at(-1))?.id ?? null,
  };
}

/** Rows as feed items: each with its preview card and the first sharing message carrying it. */
function itemsOf(db: PluginDb, payloads: ArchivePayloadReader, messagesByIds: (ids: string[]) => ArchiveMessage[], rows: LinkRow[]): LinkItem[] {
  const cards = cardsOf(db, payloads, rows);
  const messages = new Map(messagesByIds([...new Set(rows.map((r) => r.messageId))]).map((m) => [m.id, m]));
  return cards.map(({ card, source }) => {
    const m = messages.get(card.messageId);
    return { ...card, message: m ? withLinkCard(m, card, source) : null };
  });
}

/**
 * The first message carrying the link's card as its own: a card from elsewhere (another share's, an embed fixer's, the
 * stored unfurl) replaces its card for this link and takes its notes on the link's text, so they draw in the card.
 */
export function withLinkCard(m: ArchiveMessage, card: LinkCard, source: string | null): ArchiveMessage {
  if (!card.embed || source === m.id) return m;
  const linkText = partKey.linkText(card.url);
  return {
    ...m,
    embeds: [...m.embeds.filter((e) => e.url === null || normalizeUrl(e.url) !== card.url), { ...card.embed, notes: [...(card.embed.notes ?? []), ...m.notes.filter((n) => n.part === linkText)] }],
    notes: m.notes.filter((n) => n.part !== linkText),
  };
}

/** Each row with its preview card, and the share the card came from (null: the link's stored unfurl, or no card). */
function cardsOf(db: PluginDb, payloads: ArchivePayloadReader, rows: LinkRow[]): { card: LinkCard; source: string | null }[] {
  const shares = new Map<number, Share[]>();
  if (rows.length) {
    const all = db
      .prepare(
        `SELECT ml.link_id AS linkId, m.id AS messageId
         FROM archive_all_message_links ml JOIN archive_all_messages m ON m.id = ml.message_id
         WHERE ml.link_id IN (${rows.map(() => '?').join(',')}) ORDER BY m.ts`,
      )
      .all(...rows.map((r) => r.id)) as { linkId: number; messageId: string }[];
    const details = payloads(all.map((s) => s.messageId));
    for (const s of all) shares.set(s.linkId, [...(shares.get(s.linkId) ?? []), { messageId: s.messageId, embedsJson: details.get(s.messageId)?.embedsJson ?? null, bot: details.get(s.messageId)?.bot ?? null }]);
  }
  return rows.map((r) => {
    const { embed, source } = embedFor(r, shares.get(r.id) ?? []);
    return { card: { ...r, flagged: (r.flagged ?? 0) >= FLAG_AT, embed }, source };
  });
}

/** Lists each visible link at the person's latest visible share, newest first. */
export function personLinkPage(db: PluginDb, payloads: ArchivePayloadReader, q: PersonLinksQuery): LinkCard[] {
  const rows = db
    .prepare(
      // SQLite fills the bare columns of `s` from the MAX(ts) row: their latest share of the link.
      `SELECT ${LINK_COLUMNS}, s.ts, s.messageId, s.channelId, COALESCE(c.name, s.channelId) AS channelName, COALESCE(g.name, '') AS guildName,
              (SELECT m.author_name FROM archive_all_messages m WHERE m.id = s.messageId) AS authorName
       FROM (SELECT ml.link_id AS linkId, m.id AS messageId, m.channel_id AS channelId, MAX(m.ts) AS ts
             FROM archive_messages m JOIN archive_all_message_links ml ON ml.message_id = m.id
             WHERE m.author_id = ? GROUP BY ml.link_id) s
       JOIN archive_links l ON l.id = s.linkId
       LEFT JOIN ${JUDGMENTS} j ON j.url = l.url
       LEFT JOIN archive_all_channels c ON c.id = s.channelId
       LEFT JOIN archive_all_guilds g ON g.id = c.guild_id
       ORDER BY s.ts DESC, l.id DESC LIMIT ?`,
    )
    .all(q.userId, q.limit) as LinkRow[];
  return cardsOf(db, payloads, rows).map((c) => c.card);
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
