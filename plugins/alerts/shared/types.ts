// Alerts: what a rule's Alert action lists in the Alerts panel, and how often it may notify.
import { MS_PER_HOUR, MS_PER_MIN } from '@plugin-sdk/shared';

/** An alert from a rule's Alert action (#89). */
export interface AlertItem {
  id: number;
  ruleId: number;
  /** The rule's name. */
  sourceName: string;
  messageId: string;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string;
  /** Discord avatar hash; null when the user has none or isn't archived. */
  authorAvatar: string | null;
  ts: number;
  /** Message text around the match, Discord markup kept (tokens whole). */
  snippet: string;
  /** Display names of the users the message mentions, by id, for drawing <@id> in the snippet. */
  mentions: Record<string, string>;
  readAt: number | null;
  /** `pattern`: the rule matched it itself (keywords, contents, a direct hit); `meaning`: Jev did. */
  matchKind: 'pattern' | 'meaning';
  /** Jev's probability for a meaning match; null for pattern matches. */
  probability: number | null;
  /** #55: the earlier alert Jev judged this one repeats (no notification); null otherwise. */
  duplicateOf: number | null;
}

export interface AlertQuery {
  limit: number;
  unreadOnly?: boolean;
  /** Only alerts of these rules; absent or empty = every alert. */
  ruleIds?: number[];
  /** Keyset cursor: the last item of the previous page (newest first). */
  after?: { ts: number; id: number };
}

/** Notification cooldown choices offered for a rule's Alert. */
export const ALERT_COOLDOWNS: { ms: number; label: string }[] = [
  { ms: 0, label: 'Notify every match' },
  { ms: 5 * MS_PER_MIN, label: 'At most every 5 min' },
  { ms: 15 * MS_PER_MIN, label: 'At most every 15 min' },
  { ms: MS_PER_HOUR, label: 'At most hourly' },
];
export const DEFAULT_ALERT_COOLDOWN_MS = 5 * MS_PER_MIN;
