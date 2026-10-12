import { MS_PER_MIN, MS_PER_HOUR, MS_PER_DAY } from '@plugin-sdk/shared';

/** The panel's scope choices and their labels. */
export const STATS_SCOPES = { channel: 'This channel', server: 'This server', all: 'Everything' } as const;
export type StatsScope = keyof typeof STATS_SCOPES;

/** The panel's range choices: label and span in days (null: all archived). */
export const STATS_RANGES = {
  '7d': { label: 'Last 7 days', days: 7 },
  '30d': { label: 'Last 30 days', days: 30 },
  '90d': { label: 'Last 90 days', days: 90 },
  '365d': { label: 'Last year', days: 365 },
  all: { label: 'All archived', days: null },
} as const;
export type StatsRange = keyof typeof STATS_RANGES;

/** Sections in the panel's rail, in display order. */
export const STATS_SECTIONS = {
  overview: 'Overview', messages: 'Messages', people: 'People', channels: 'Channels', links: 'Links', timeline: 'Timeline',
  emoji: 'Emoji', words: 'Words', sentiment: 'Sentiment', conversations: 'Conversations',
} as const;
export type StatsSection = keyof typeof STATS_SECTIONS;

/** Whether `v` is one of `o`'s keys. */
export const isKey =
  <T extends object>(o: T) =>
  (v: unknown): v is keyof T =>
    typeof v === 'string' && Object.hasOwn(o, v);

/** Analytics messages to count. `channelId` anchors 'channel' (with its threads) and 'server' (its server). */
export interface ActivityQuery {
  scope: 'channel' | 'server' | 'all';
  channelId: string | null;
  /** Count messages from this time on; null for the whole archive. */
  sinceTs: number | null;
}

/** One ranked person, including the avatar hash exposed by the archive. */
export interface StatsPoster {
  userId: string;
  name: string;
  avatar: string | null;
  count: number;
}

export interface PostersQuery extends ActivityQuery {
  offset: number;
  limit: number;
}

export interface StatsChannel {
  channelId: string;
  name: string;
  count: number;
}

export interface StatsPeriod {
  /** Local start, with hour precision for hours and date precision otherwise. */
  start: string;
  count: number;
}

/** Every ranked summary shows ten entries; expanded people are read in bounded pages. */
export const STATS_TOP = 10;
export const POSTERS_PAGE_SIZE = 50;
export const POSTERS_PAGE_MAX = 200;

/** Minute, hour, day and week boundaries separate immediate corrections from later revisions. */
const EDIT_IMMEDIATE_MS = MS_PER_MIN;
const EDIT_SAME_HOUR_MS = MS_PER_HOUR;
const EDIT_SAME_DAY_MS = MS_PER_DAY;
const EDIT_SAME_WEEK_DAYS = 7;
const EDIT_SAME_WEEK_MS = EDIT_SAME_WEEK_DAYS * MS_PER_DAY;
export const EDIT_DELAY_BUCKETS = [
  { id: 'minute', label: 'Under a minute', beforeMs: EDIT_IMMEDIATE_MS },
  { id: 'hour', label: 'A minute to an hour', beforeMs: EDIT_SAME_HOUR_MS },
  { id: 'day', label: 'An hour to a day', beforeMs: EDIT_SAME_DAY_MS },
  { id: 'week', label: 'A day to a week', beforeMs: EDIT_SAME_WEEK_MS },
  { id: 'later', label: 'A week or later', beforeMs: null },
] as const;
export const ATTACHMENT_KINDS = ['image', 'video', 'audio', 'other'] as const;

export interface ActivityStats {
  /** The exact range anchor used for this read and subsequent poster pages. */
  query: ActivityQuery;
  /** First visible archived message in the whole scope, independent of the selected range. */
  archivedSince: number | null;
  messages: number;
  authors: number;
  activeDays: number;
  editedMessages: number;
  textMessages: number;
  linkedMessages: number;
  attachmentMessages: number;
  mostActive: Record<'hour' | 'day' | 'month' | 'year', StatsPeriod | null>;
  /** Bar width of `buckets`: days for short spans, weeks (from Monday) for long ones. */
  bucket: 'day' | 'week';
  /** Every local day or Monday-start week from the first bucket through the last, including zero counts; oldest first (YYYY-MM-DD). */
  buckets: { start: string; count: number }[];
  /** Messages by local weekday (0 = Sunday) then hour (0–23). */
  heatmap: number[][];
  posters: StatsPoster[];
  channels: StatsChannel[];
  editDelay: { id: typeof EDIT_DELAY_BUCKETS[number]['id']; count: number }[];
  attachmentTypes: { kind: typeof ATTACHMENT_KINDS[number]; count: number }[];
  /** Link shares by registrable site, with every contributing host; most first. */
  domains: { domain: string; count: number; hosts: { host: string; count: number }[] }[];
  linksByPerson: StatsPoster[];
  linksByChannel: StatsChannel[];
  /** Every local month from the range start through the last message, including empty months. */
  timeline: { start: string; activePosters: number; newPosters: number }[];
}
