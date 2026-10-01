// Alert rows as stored: how a message matched, the insert, the snippet shown, and #54's "already answered".
import { contentSummary, type ContentKind } from '@plugin-sdk/shared';
import { type TextMessage, type ArchiveReplyExists } from '@plugin-sdk/core';
import { ALERTS } from './tables';

export { snippet } from '@plugin-sdk/core';

export const INSERT_ALERT = `INSERT OR IGNORE INTO ${ALERTS} (rule_id, message_id, channel_id, author_id, ts, snippet, created_at, read_at, match_kind, probability)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Alert text for `m`: its text, else what it carries (e.g. "[Voice message]"). */
export const alertText = (m: TextMessage, kinds: () => ReadonlySet<ContentKind>): string =>
  m.content || contentSummary(kinds());

/** #54: someone other than the asker already replied to `m` (a Discord reply). */
export function hasReply(replyExists: ArchiveReplyExists, m: TextMessage): boolean {
  return replyExists(m.channelId, m.ts, m.authorId, m.id);
}
