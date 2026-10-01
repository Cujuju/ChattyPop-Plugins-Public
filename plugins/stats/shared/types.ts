/** The panel's scope choices and their labels. */
export const STATS_SCOPES = { channel: 'This channel', server: 'This server', all: 'Everything' } as const;
export type StatsScope = keyof typeof STATS_SCOPES;

/** The panel's range choices: label and span in days (null: all time). */
export const STATS_RANGES = {
  '7d': { label: 'Last 7 days', days: 7 },
  '30d': { label: 'Last 30 days', days: 30 },
  '90d': { label: 'Last 90 days', days: 90 },
  '365d': { label: 'Last year', days: 365 },
  all: { label: 'All time', days: null },
} as const;
export type StatsRange = keyof typeof STATS_RANGES;

/** Whether `v` is one of `o`'s keys. */
export const isKey =
  <T extends object>(o: T) =>
  (v: unknown): v is keyof T =>
    typeof v === 'string' && Object.hasOwn(o, v);

/** #85 activity stats: which messages to count. `channelId` anchors 'channel' (with its threads) and 'server' (its server). */
export interface ActivityQuery {
  scope: 'channel' | 'server' | 'all';
  channelId: string | null;
  /** Count messages from this time on; null for the whole archive. */
  sinceTs: number | null;
}

export interface ActivityStats {
  messages: number;
  authors: number;
  /** Bar width of `buckets`: days for short spans, weeks (from Monday) for long ones. */
  bucket: 'day' | 'week';
  /** Local-date start of each non-empty bucket (YYYY-MM-DD), oldest first. */
  buckets: { start: string; count: number }[];
  /** Messages by local weekday (0 = Sunday) then hour (0–23). */
  heatmap: number[][];
  posters: { userId: string; name: string; count: number }[];
  /** Link shares by host name, most first. */
  domains: { domain: string; count: number }[];
}
