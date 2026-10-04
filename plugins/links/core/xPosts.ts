// Fetch and cache linked X posts, and supply their text to the archive.
import { MS_PER_HOUR, mediaSize, type ArchiveEmbed } from '@plugin-sdk/shared';
import { MEANING_LOOKBACK_MS, X_POST_URL_PREFIX, X_STATUS_PATH, type CoreContext, type LinkImage, type PluginDb, type TextMessage } from '@plugin-sdk/core';
import type { LinkCard } from '../shared/types';
import { X_POSTS } from './tables';

/** The context's fetch: HTTPS to the descriptor's network hosts only. */
type Fetch = CoreContext['net']['fetch'];
/** The context's link stores: a post's text becomes what messages linking to it say, its photos images they show. */
type LinkStores = Pick<CoreContext['archive'], 'linkText' | 'linkImages'>;

/** FxTwitter's public status API (v2): a post's text, author and media as JSON, no key needed. */
const FXTWITTER_STATUS_API = 'https://api.fxtwitter.com/2/status/';
/** Names the app to FxTwitter's operators instead of Node's generic agent. */
const USER_AGENT = 'ChattyPop (personal Discord archive)';
/** A hung request would stall every post queued behind it. */
const FETCH_TIMEOUT_MS = 15_000;
/** After an outage or rate limit, a later view tries again at most this often. */
const RETRY_AFTER_ERROR_MS = MS_PER_HOUR;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
/** Discord markdown syntax characters; a backslash before any of them renders it literally. */
const MARKDOWN_SPECIAL = /[\\`*_~|<>@#[\]-]/g;
/** URLs stay unescaped: the markdown parser takes a URL whole, so a backslash inside one would break the link. */
const URL_RUN = /(https?:\/\/\S+)/;

type XPostState = 'ok' | 'unavailable' | 'error';

/** The FxTwitter status fields the card uses. */
interface FxStatus {
  url: string;
  text: string;
  author: { name: string; screen_name: string; avatar_url: string | null };
  media?: { photos?: { url: string; width?: number; height?: number }[]; videos?: { thumbnail_url?: string | null; width?: number; height?: number }[] };
}

/** A post's photos as link images (a video's still is a frame, not a picture shared to be read). */
const photosOf = (s: FxStatus): LinkImage[] =>
  (s.media?.photos ?? []).map((p) => ({ url: p.url, ...(p.width && p.height ? { width: p.width, height: p.height } : {}) }));

const statusId = (url: string): string | null => X_STATUS_PATH.exec(new URL(url).pathname)?.[1] ?? null;

/** Post text is plain; escape it so "_" in @handles or "*" isn't read as formatting. */
const escapeMarkdown = (text: string): string =>
  text
    .split(URL_RUN)
    .map((part, i) => (i % 2 ? part : part.replace(MARKDOWN_SPECIAL, '\\$&')))
    .join('');

/** A post as the embed card draws it: author (linking to the post), text, and its first photo or video still. */
function xEmbed(s: FxStatus): ArchiveEmbed {
  const photo = s.media?.photos?.[0], video = s.media?.videos?.[0];
  return {
    type: 'link',
    url: s.url,
    title: null,
    description: s.text ? escapeMarkdown(s.text) : null,
    color: null,
    provider: null,
    author: { name: `${s.author.name} (@${s.author.screen_name})`, url: s.url, iconUrl: s.author.avatar_url },
    thumbnailUrl: null,
    thumbnailSize: null,
    imageUrl: photo?.url ?? video?.thumbnail_url ?? null,
    imageSize: mediaSize(photo ?? video),
    videoUrl: null,
    videoSize: null,
    footer: null,
  };
}

async function fetchStatus(net: Fetch, id: string, lifetime: AbortSignal): Promise<{ state: XPostState; json: string | null }> {
  try {
    const res = await net(FXTWITTER_STATUS_API + id, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), lifetime]) });
    if (res.ok) {
      const body = (await res.json()) as { status?: unknown };
      return body.status ? { state: 'ok', json: JSON.stringify(body.status) } : { state: 'error', json: null };
    }
    // Other 4xx: the post is deleted, private or suspended.
    const gone = res.status < HTTP_SERVER_ERROR && res.status !== HTTP_TOO_MANY_REQUESTS;
    return { state: gone ? 'unavailable' : 'error', json: null };
  } catch {
    return { state: 'error', json: null };
  }
}

/**
 * X posts for links Discord never previewed, fetched from FxTwitter one at a time as the Links views ask for them or a
 * new message shares one, and kept in its table. A post not yet fetched shows once it arrives (onFetched triggers a
 * refresh); its text becomes the link's text (setLinkText). Turned off, fetching pauses; queued posts wait for the next
 * activation, which also queues posts shared while it was off.
 */
export class XPosts {
  private draining = false;

  constructor(
    private readonly db: PluginDb,
    private readonly net: Fetch,
    private readonly links: LinkStores,
    private readonly onFetched: () => void,
    /** Posts still to fetch, in order; outlives the activation, so turning Links off pauses them rather than drops them. */
    private readonly queue: Set<string> = new Set(),
    /** The activation's lifetime: a running fetch is cancelled and its post stays queued. */
    private readonly lifetime: AbortSignal = new AbortController().signal,
  ) {}

  /**
   * On activation: gives recently shared posts fetched before their photos as link images (fetched before Links supplied
   * them), queues those never fetched (shared while Links was off), then fetches the queue.
   */
  resume(): void {
    const ids = this.db
      .prepare(
        `SELECT DISTINCT substr(l.url, @from) FROM archive_all_links l
         WHERE l.first_ts >= @since AND l.url LIKE @prefix AND l.title IS NULL AND l.description IS NULL`,
      )
      .pluck()
      .all({ since: Date.now() - MEANING_LOOKBACK_MS, prefix: `${X_POST_URL_PREFIX}%`, from: X_POST_URL_PREFIX.length + 1 }) as string[];
    this.publishPhotos(ids);
    this.due(ids);
    void this.drain();
  }

  /**
   * Fetches the posts behind a new message's X links that have no text (Discord sent no preview), so Jev and the labels
   * read the post, not the URL. Only for messages Jev still judges (the lookback), so backfill doesn't flood FxTwitter.
   */
  fetchFor(m: TextMessage): void {
    if (m.ts < Date.now() - MEANING_LOOKBACK_MS) return;
    const ids = this.db
      .prepare(
        `SELECT substr(l.url, @from) FROM archive_all_message_links ml JOIN archive_all_links l ON l.id = ml.link_id
         WHERE ml.message_id = @id AND l.url LIKE @prefix AND l.title IS NULL AND l.description IS NULL`,
      )
      .pluck()
      .all({ id: m.id, prefix: `${X_POST_URL_PREFIX}%`, from: X_POST_URL_PREFIX.length + 1 }) as string[];
    this.publishPhotos(ids);
    if (this.due(ids).length) void this.drain();
  }

  /** Posts among `ids` fetched before (however long ago) give their photos as link images again, for a new share. */
  private publishPhotos(ids: string[]): void {
    if (!ids.length) return;
    const rows = this.db
      .prepare(`SELECT status_id AS id, status_json AS json FROM ${X_POSTS} WHERE state = 'ok' AND status_id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(ids)) as { id: string; json: string }[];
    for (const p of rows) {
      const photos = photosOf(JSON.parse(p.json) as FxStatus);
      if (photos.length) this.links.linkImages.set(X_POST_URL_PREFIX + p.id, photos);
    }
  }

  /** Posts among `ids` to fetch now, queued: never fetched, or failed longer than the retry interval ago. */
  private due(ids: string[]): string[] {
    if (!ids.length) return [];
    const rows = this.db
      .prepare(`SELECT status_id AS id, state, fetched_at AS fetchedAt FROM ${X_POSTS} WHERE status_id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as { id: string; state: XPostState; fetchedAt: number }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const now = Date.now();
    const due = ids.filter((id) => {
      const r = byId.get(id);
      return !r || (r.state === 'error' && now - r.fetchedAt >= RETRY_AFTER_ERROR_MS);
    });
    for (const id of due) this.queue.add(id);
    return due;
  }

  /** Gives X links without a Discord preview their fetched post's card; queues posts not fetched yet. */
  fill<T extends LinkCard>(items: T[]): T[] {
    const ids = new Map<T, string>();
    for (const it of items) {
      const id = it.platform === 'x' && !it.embed ? statusId(it.url) : null;
      if (id) ids.set(it, id);
    }
    if (!ids.size) return items;
    const wanted = [...new Set(ids.values())];
    const rows = this.db
      .prepare(`SELECT status_id AS id, state, status_json AS json FROM ${X_POSTS} WHERE status_id IN (${wanted.map(() => '?').join(',')})`)
      .all(...wanted) as { id: string; state: XPostState; json: string | null }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    this.due(wanted);
    void this.drain();
    return items.map((it) => {
      const r = byId.get(ids.get(it) ?? '');
      return r?.state === 'ok' && r.json ? { ...it, embed: xEmbed(JSON.parse(r.json) as FxStatus) } : it;
    });
  }

  private async drain(): Promise<void> {
    if (this.draining || this.lifetime.aborted) return;
    this.draining = true;
    try {
      for (let id = this.next(); id; id = this.next()) {
        const r = await fetchStatus(this.net, id, this.lifetime);
        // The archive is being moved, or the plugin turned off: the post stays queued for the next activation.
        if (!this.db.open || this.lifetime.aborted) return;
        this.queue.delete(id);
        const record = (): void =>
          void this.db
            .prepare(
              `INSERT INTO ${X_POSTS} (status_id, state, status_json, fetched_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(status_id) DO UPDATE SET state = excluded.state, status_json = excluded.status_json, fetched_at = excluded.fetched_at`,
            )
            .run(id, r.state, r.json, Date.now());
        const status = r.state === 'ok' && r.json ? (JSON.parse(r.json) as FxStatus) : null;
        // The host judges again the messages this gives text: a Discord preview that came meanwhile already did.
        if (status?.text) this.links.linkText.set(X_POST_URL_PREFIX + id, status.text, record);
        else record();
        const photos = status ? photosOf(status) : [];
        if (photos.length) this.links.linkImages.set(X_POST_URL_PREFIX + id, photos);
        if (r.state === 'ok') this.onFetched();
      }
    } finally {
      this.draining = false;
    }
  }

  /** The oldest queued post; it leaves the queue once its result is stored. */
  private next(): string | undefined {
    return this.queue.values().next().value;
  }
}
