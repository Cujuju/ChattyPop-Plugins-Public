// The Links feed's items and queries, shared by its core side (the feed) and renderer side (the panel).
import type { ArchiveEmbed, ArchiveMessage, Platform } from '@plugin-sdk/shared';

/** What kind of thing a link is (#61), as Jev reads it from the link and its preview. */
export const LINK_CATEGORIES = ['video', 'article', 'tool', 'meme', 'music', 'news', 'social', 'image', 'discussion', 'shopping', 'other'] as const;
export type LinkCategory = (typeof LINK_CATEGORIES)[number];

/** Worth-reading levels (#63), lowest first. LinkItem.worth is Jev's expected level: 0 to length − 1, fractional. */
export const LINK_WORTH_LEVELS = ['skip', 'low', 'some', 'good', 'must see'] as const;

/** A shared link with its preview card, at one share of it: the first (the feed) or a person's latest (their links). */
export interface LinkCard {
  id: number;
  url: string;
  platform: Platform;
  title: string | null;
  description: string | null;
  /** Discord media-proxy URL of the preview image (render via thumbUrl). */
  thumbnailUrl: string | null;
  site: string | null;
  ts: number;
  messageId: string;
  channelId: string;
  channelName: string;
  guildName: string;
  authorName: string;
  /** Messages that shared this URL. */
  shares: number;
  /**
   * Discord's preview card for the link (earliest share that has one), rendered as the Archive renders embeds. An X post
   * Discord never previewed gets its card from FxTwitter once fetched. null when neither exists.
   */
  embed: ArchiveEmbed | null;
  /** Jev's reading (#61–#63), when that feature is on and the link has been judged; otherwise null / false. */
  category: LinkCategory | null;
  /** Likely spam, a scam or NSFW (#62). */
  flagged: boolean;
  /** Expected level in LINK_WORTH_LEVELS, 0–4 and fractional (#63). */
  worth: number | null;
}

/** A shared link as the Links panel renders it, from its first-seen message. */
export interface LinkItem extends LinkCard {
  /** The message that first shared the link, as the Archive shows it (text, avatar, reactions); null if it left the archive. */
  message: ArchiveMessage | null;
}

/** A person's links, newest first by their latest share of each: the first `limit`. */
export interface PersonLinksQuery {
  userId: string;
  limit: number;
}

/** Keyset cursor: the last item of the previous page. `worth` is part of it when sorting by worth (-1 = unjudged). */
export interface LinkCursor {
  ts: number;
  id: number;
  worth?: number;
}

/** newest: by first share. worth: most worth reading first (#63), unjudged last, then newest. */
export type LinkSort = 'newest' | 'worth';

/** Channel filter matches the channel where the link was first shared (items are deduped by URL). */
export interface LinkFilter {
  platforms?: Platform[];
  channelId?: string;
  sinceTs?: number;
  untilTs?: number;
  /** Leave out links Jev flagged (#62). */
  hideFlagged?: boolean;
}

export interface LinkPageQuery extends LinkFilter {
  limit: number;
  sort?: LinkSort;
  after?: LinkCursor;
}
