import type { ArchiveRead, TextMessage } from '@plugin-sdk/core';
import type { MessageTagChip, Tag, TaggedMessage, TagRangeRequest } from '../shared/types';
import { channelChipsSql, SHOWN_TAG_SQL, taggedSql, tagListSql, toTag, type CountedTagRow } from './store';
import { TAGS, MESSAGE_TAGS } from './tables';
import { rangeMessagesSql } from './questions';

/** Live chips cover the embedded client's newest five hundred tagged messages. */
export const LIVE_CHIPS_MAX = 500;

export async function tagsRead(read: ArchiveRead): Promise<Tag[]> {
  const q = tagListSql();
  return (await read<CountedTagRow>(q.sql, q.params)).map(toTag);
}

export async function messageChipsRead(read: ArchiveRead, ids: string[]): Promise<Record<string, MessageTagChip[]>> {
  if (!ids.length) return {};
  const rows = await read<MessageTagChip & { messageId: string }>(
    `SELECT mt.message_id AS messageId, t.id AS tagId, t.name, mt.state AS source
      FROM ${MESSAGE_TAGS} mt JOIN ${TAGS} t ON t.id = mt.tag_id
      WHERE mt.${SHOWN_TAG_SQL} AND mt.message_id IN (SELECT value FROM json_each(?)) ORDER BY t.name`, [JSON.stringify(ids)]);
  const result: Record<string, MessageTagChip[]> = {};
  for (const { messageId, ...chip } of rows) (result[messageId] ??= []).push(chip);
  return result;
}

export async function liveChipsRead(read: ArchiveRead, channelId: string): Promise<Record<string, MessageTagChip[]>> {
  const ids = await read<{ id: string }>(channelChipsSql(), [channelId, LIVE_CHIPS_MAX]);
  return messageChipsRead(read, ids.map(({ id }) => id));
}

export function taggedRead(read: ArchiveRead, id: number, limit: number): Promise<TaggedMessage[]> {
  const q = taggedSql(id, limit);
  return read<TaggedMessage>(q.sql, q.params);
}

export async function rangeCountRead(read: ArchiveRead, req: TagRangeRequest): Promise<number> {
  const q = rangeMessagesSql(req);
  const [row] = await read<{ n: number }>(`SELECT COUNT(*) AS n FROM (${q.sql})`, q.params);
  return row?.n ?? 0;
}

export async function manualMessageRead(read: ArchiveRead, id: string): Promise<TextMessage | undefined> {
  return (await read<TextMessage>('SELECT id, channel_id AS channelId, author_id AS authorId, ts, text AS content, linked FROM archive_all_messages WHERE id = ?', [id]))[0];
}
