// The message log a summary run reads: one line per archived message with text, and its digest for the cache key.
import { USER_MENTION } from '@plugin-sdk/core';
import { createHash } from 'node:crypto';
import type { SummaryGrouping } from '../shared/settings';
import type { PluginDb, ArchiveReplyReader } from '@plugin-sdk/core';
import { clipMessage } from '@plugin-sdk/core';
import { isFiller } from './filler';
import type { LogLine } from './summaryJev';
import { stamp } from './summaryPrompt';
import { markedTag, personTag, type TaggedPerson } from './people';

/** Precedes what a message links to (a fetched post's text, a preview), so the model tells it from what was said. */
const LINKED_MARK = '↳ links to:';

/**
 * Log lines with short refs; refs map back to real message ids after the model answers. Chronological, or per channel
 * (in order of each channel's first message) when grouped by channel. Mentions read as names; dates show when the range spans days.
 * Each person the model reads carries their tag after their name ({{p3}}), which it writes to name them. A message's
 * linked text (a shared tweet's) follows its own, clipped as it is.
 */
export function readLog(db: PluginDb, payloads: ArchiveReplyReader, channelIds: string[], sinceTs: number, untilTs: number, grouping: SummaryGrouping, skipObviousFiller = false): LogLine[] {
  if (!channelIds.length) return [];
  const rows = db.prepare(`SELECT m.id, m.channel_id AS channelId, c.name AS channelName, m.ts, m.text AS content, m.linked,
    m.deleted_at AS deletedAt, m.author_plain_name AS author, m.author_id AS authorId
    FROM archive_all_messages m JOIN archive_all_channels c ON c.id = m.channel_id
    WHERE m.channel_id IN (${channelIds.map(() => '?').join(',')}) AND m.ts >= ? AND m.ts <= ? AND (m.text != '' OR m.linked != '')
    ORDER BY m.ts, length(m.id), m.id`).all(...channelIds, sinceTs, untilTs) as {
      id: string; channelId: string; channelName: string; ts: number; content: string; linked: string;
      deletedAt: number | null; author: string; authorId: string;
    }[];
  if (!rows.length) return [];
  if (grouping === 'channel') {
    const firstAt = new Map<string, number>();
    rows.forEach((r, i) => firstAt.has(r.channelId) || firstAt.set(r.channelId, i));
    rows.sort((a, b) => firstAt.get(a.channelId)! - firstAt.get(b.channelId)!); // stable: chronological within a channel
  }
  const ids = [...new Set(rows.flatMap((r) => [...r.content.matchAll(USER_MENTION)].map((m) => m[1]!)))];
  const names: Record<string, string> = Object.fromEntries(ids.length ? db.prepare(
    `SELECT id, display_name FROM archive_users WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).raw().all(...ids) as [string, string][] : []);
  const tags = new Map<string, TaggedPerson>();
  const person = (userId: string, name: string): TaggedPerson => {
    const known = tags.get(userId) ?? { tag: personTag(tags.size + 1), userId, name };
    tags.set(userId, known);
    return known;
  };
  const named = (text: string, tagged: boolean): string =>
    text.replace(USER_MENTION, (raw, id: string) => (names[id] ? `@${names[id]}${tagged ? ` ${markedTag(person(id, names[id]).tag)}` : ''}` : raw));
  const details = skipObviousFiller ? payloads(rows.map((r) => r.id)) : new Map();
  const withDate = new Date(sinceTs).toDateString() !== new Date(untilTs).toDateString();
  const said = (r: (typeof rows)[number], tagged: boolean): string => {
    const own = clipMessage(named(r.content, tagged));
    return r.linked ? `${own} ${LINKED_MARK} ${clipMessage(r.linked)}`.trim() : own;
  };
  return rows.map((r, i) => {
    const ref = `m${i + 1}`;
    const deleted = r.deletedAt ? ' (deleted)' : '';
    const author = person(r.authorId, r.author);
    const tagged = `${r.author} ${markedTag(author.tag)}${deleted}: ${said(r, true)}`;
    return {
      ref,
      citation: { messageId: r.id, channelId: r.channelId, channelName: r.channelName, ts: r.ts },
      text: `[${ref}] #${r.channelName} ${stamp(r.ts, withDate)} ${tagged}`,
      plain: `${r.author}${deleted}: ${said(r, false)}`,
      // A bare link is no filler when its post has text.
      filler: skipObviousFiller && !r.linked && isFiller(r.content, details.get(r.id)?.isReply === 1),
      people: [author, ...[...r.content.matchAll(USER_MENTION)].flatMap((m) => (names[m[1]!] ? [tags.get(m[1]!)!] : []))],
    };
  });
}

/** Each message and its text: a new message, an edit, or a transcript or linked text arriving later each mean a new summary. */
export const logDigest = (lines: LogLine[]): string => createHash('sha256').update(JSON.stringify(lines.map((l) => [l.citation.messageId, l.plain]))).digest('hex');
