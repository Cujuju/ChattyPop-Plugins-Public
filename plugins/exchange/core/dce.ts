// DiscordChatExporter (DCE) JSON export format: import maps it to Discord payloads; export writes it from them.
// Lossy by nature: DCE keeps display data, not every raw field (e.g. embed proxy URLs, message flags).
import { type RawMessage, SNOWFLAKE_ID } from '@plugin-sdk/shared';

/** Discord message types ChattyPop distinguishes; everything else round-trips as Default. */
const REPLY_MESSAGE_TYPE = 19;
const DEFAULT_MESSAGE_TYPE = 0;
const HEX_RADIX = 16;
const COLOR_HEX_DIGITS = 6;

export interface DceUser {
  id: string;
  name: string;
  nickname?: string | null;
  isBot?: boolean;
  avatarUrl?: string | null;
}

export interface DceEmbed {
  title?: string | null;
  url?: string | null;
  description?: string | null;
  color?: string | null;
  author?: { name?: string | null; url?: string | null; iconUrl?: string | null } | null;
  thumbnail?: { url: string; width?: number; height?: number } | null;
  images?: { url: string; width?: number; height?: number }[];
  video?: { url: string; width?: number; height?: number } | null;
  footer?: { text: string; iconUrl?: string | null } | null;
  fields?: { name: string; value: string; isInline?: boolean }[];
}

export interface DceMessage {
  id: string;
  type: string;
  timestamp: string;
  timestampEdited?: string | null;
  isPinned?: boolean;
  content: string;
  author: DceUser;
  attachments?: { id: string; url: string; fileName: string; fileSizeBytes?: number }[];
  embeds?: DceEmbed[];
  stickers?: { id: string; name: string; format?: string; sourceUrl?: string }[];
  reactions?: { emoji: { id?: string | null; name: string; isAnimated?: boolean }; count: number }[];
  mentions?: DceUser[];
  reference?: { messageId?: string | null; channelId?: string | null; guildId?: string | null } | null;
}

export interface DceExport {
  guild: { id: string; name: string; iconUrl?: string | null };
  channel: { id: string; type?: string; categoryId?: string | null; category?: string | null; name: string; topic?: string | null };
  exportedAt?: string;
  messages: DceMessage[];
  messageCount?: number;
}

/** Discord payload shapes read from raw_json (only what the mapping touches). */
interface RawEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  author?: { name?: string; url?: string; icon_url?: string };
  thumbnail?: { url: string; proxy_url?: string; width?: number; height?: number };
  image?: { url: string; proxy_url?: string; width?: number; height?: number };
  video?: { url: string; proxy_url?: string; width?: number; height?: number };
  footer?: { text: string; icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}
type RawAttachment = { id: string; filename: string; size?: number; url: string; proxy_url?: string };
type RawReaction = { emoji: { id: string | null; name: string | null; animated?: boolean }; count: number };
type RawUserLike = { id: string; username: string; global_name?: string | null; bot?: boolean; avatar?: string | null };
type FullRaw = RawMessage & {
  type?: number;
  pinned?: boolean;
  attachments?: RawAttachment[];
  embeds?: RawEmbed[];
  sticker_items?: { id: string; name: string; format_type?: number }[];
  reactions?: RawReaction[];
  mentions?: RawUserLike[];
  message_reference?: { message_id?: string; channel_id?: string; guild_id?: string };
};

const colorToInt = (hex?: string | null): number | undefined => (hex && /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), HEX_RADIX) : undefined);
const intToColor = (n?: number): string | null => (typeof n === 'number' ? `#${n.toString(HEX_RADIX).padStart(COLOR_HEX_DIGITS, '0')}` : null);
const media = (m?: { url: string; width?: number; height?: number } | null) =>
  m ? { url: m.url, proxy_url: m.url, ...(m.width ? { width: m.width } : {}), ...(m.height ? { height: m.height } : {}) } : undefined;
const user = (u: DceUser): RawUserLike => ({ id: u.id, username: u.name, global_name: u.nickname ?? null, bot: u.isBot ?? false });

/** A DCE message as the Discord payload ChattyPop stores (raw_json), for a channel of the export. */
export function dceToRaw(m: DceMessage, channelId: string): RawMessage {
  const embeds: RawEmbed[] = (m.embeds ?? []).map((e) => ({
    ...(e.title ? { title: e.title } : {}),
    ...(e.url ? { url: e.url } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(colorToInt(e.color) !== undefined ? { color: colorToInt(e.color)! } : {}),
    ...(e.author?.name
      ? { author: { name: e.author.name, ...(e.author.url ? { url: e.author.url } : {}), ...(e.author.iconUrl ? { icon_url: e.author.iconUrl } : {}) } }
      : {}),
    ...(e.thumbnail ? { thumbnail: media(e.thumbnail)! } : {}),
    ...(e.images?.[0] ? { image: media(e.images[0])! } : {}),
    ...(e.video ? { video: media(e.video)! } : {}),
    ...(e.footer ? { footer: { text: e.footer.text, ...(e.footer.iconUrl ? { icon_url: e.footer.iconUrl } : {}) } } : {}),
    ...(e.fields?.length ? { fields: e.fields.map((f) => ({ name: f.name, value: f.value, inline: f.isInline ?? false })) } : {}),
  }));
  const raw: FullRaw = {
    id: m.id,
    channel_id: channelId,
    type: m.type === 'Reply' ? REPLY_MESSAGE_TYPE : DEFAULT_MESSAGE_TYPE,
    author: user(m.author),
    content: m.content,
    timestamp: m.timestamp,
    edited_timestamp: m.timestampEdited ?? null,
    pinned: m.isPinned ?? false,
    attachments: (m.attachments ?? []).map((a) => ({
      id: a.id,
      filename: a.fileName,
      url: a.url,
      proxy_url: a.url,
      ...(a.fileSizeBytes ? { size: a.fileSizeBytes } : {}),
    })),
    embeds,
    sticker_items: (m.stickers ?? []).map((s) => ({ id: s.id, name: s.name })),
    reactions: (m.reactions ?? []).map((r) => ({
      emoji: { id: r.emoji.id || null, name: r.emoji.name, animated: r.emoji.isAnimated ?? false },
      count: r.count,
    })),
    mentions: (m.mentions ?? []).map(user),
    ...(m.reference?.messageId
      ? {
          message_reference: {
            message_id: m.reference.messageId,
            ...(m.reference.channelId ? { channel_id: m.reference.channelId } : {}),
            ...(m.reference.guildId ? { guild_id: m.reference.guildId } : {}),
          },
        }
      : {}),
  };
  return raw;
}

/** A stored Discord payload as a DCE message. `attachmentUrl` maps each attachment (e.g. to an exported local file). */
export function rawToDce(r: RawMessage, attachmentUrl: (a: RawAttachment) => string = (a) => a.url): DceMessage {
  const raw = r as FullRaw;
  const author = (u: RawUserLike): DceUser => ({ id: u.id, name: u.username, nickname: u.global_name ?? null, isBot: u.bot ?? false });
  return {
    id: raw.id,
    type: raw.type === REPLY_MESSAGE_TYPE ? 'Reply' : 'Default',
    timestamp: raw.timestamp,
    timestampEdited: raw.edited_timestamp,
    isPinned: raw.pinned ?? false,
    content: raw.content,
    author: author(raw.author),
    attachments: (raw.attachments ?? []).map((a) => ({ id: a.id, url: attachmentUrl(a), fileName: a.filename, ...(a.size ? { fileSizeBytes: a.size } : {}) })),
    embeds: (raw.embeds ?? []).map((e) => ({
      title: e.title ?? null,
      url: e.url ?? null,
      description: e.description ?? null,
      color: intToColor(e.color),
      author: e.author ? { name: e.author.name ?? null, url: e.author.url ?? null, iconUrl: e.author.icon_url ?? null } : null,
      thumbnail: e.thumbnail ? { url: e.thumbnail.url, width: e.thumbnail.width, height: e.thumbnail.height } : null,
      images: e.image ? [{ url: e.image.url, width: e.image.width, height: e.image.height }] : [],
      video: e.video ? { url: e.video.url, width: e.video.width, height: e.video.height } : null,
      footer: e.footer ? { text: e.footer.text, iconUrl: e.footer.icon_url ?? null } : null,
      fields: (e.fields ?? []).map((f) => ({ name: f.name, value: f.value, isInline: f.inline ?? false })),
    })),
    stickers: (raw.sticker_items ?? []).map((s) => ({ id: s.id, name: s.name })),
    reactions: (raw.reactions ?? []).map((x) => ({
      emoji: { id: x.emoji.id, name: x.emoji.name ?? '', isAnimated: x.emoji.animated ?? false },
      count: x.count,
    })),
    mentions: (raw.mentions ?? []).map(author),
    reference: raw.message_reference?.message_id
      ? { messageId: raw.message_reference.message_id, channelId: raw.message_reference.channel_id ?? null, guildId: raw.message_reference.guild_id ?? null }
      : null,
  };
}

/** A field check; `undefined` is a missing field. */
type Check = (v: unknown) => boolean;
const str: Check = (v) => typeof v === 'string';
const bool: Check = (v) => typeof v === 'boolean';
const size: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 0;
const snowflake: Check = (v) => typeof v === 'string' && SNOWFLAKE_ID.test(v);
const time: Check = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const opt = (c: Check): Check => (v) => v === undefined || c(v);
const nullable = (c: Check): Check => (v) => v === undefined || v === null || c(v);
const list = (c: Check): Check => (v) => v === undefined || (Array.isArray(v) && v.every(c));
const shape = (fields: Record<string, Check>): Check => (v) =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.entries(fields).every(([k, c]) => c((v as Record<string, unknown>)[k]));

const dceUser = shape({ id: str, name: str, nickname: nullable(str), isBot: opt(bool) });
const dceMedia = shape({ url: str, width: nullable(size), height: nullable(size) });
const dceEmbed = shape({
  title: nullable(str),
  url: nullable(str),
  description: nullable(str),
  color: nullable(str),
  author: nullable(shape({ name: nullable(str), url: nullable(str), iconUrl: nullable(str) })),
  thumbnail: nullable(dceMedia),
  images: list(dceMedia),
  video: nullable(dceMedia),
  footer: nullable(shape({ text: str, iconUrl: nullable(str) })),
  fields: list(shape({ name: str, value: str, isInline: opt(bool) })),
});
const dceMessage = shape({
  id: snowflake,
  type: str,
  timestamp: time,
  timestampEdited: nullable(time),
  isPinned: opt(bool),
  content: str,
  author: dceUser,
  attachments: list(shape({ id: str, url: str, fileName: str, fileSizeBytes: opt(size) })),
  embeds: list(dceEmbed),
  stickers: list(shape({ id: str, name: str })),
  reactions: list(shape({ emoji: shape({ id: nullable(str), name: str, isAnimated: opt(bool) }), count: size })),
  mentions: list(dceUser),
  reference: nullable(shape({ messageId: nullable(str), channelId: nullable(str), guildId: nullable(str) })),
});
const dceExport = shape({
  guild: shape({ id: str, name: str }),
  channel: shape({ id: snowflake, type: opt(str), categoryId: nullable(str), name: str }),
  messages: (v) => Array.isArray(v) && v.every(dceMessage),
});

/** Checks every field the import reads, before it writes anything: a file failing here imports nothing. */
export const isDceExport = (v: unknown): v is DceExport => dceExport(v);
