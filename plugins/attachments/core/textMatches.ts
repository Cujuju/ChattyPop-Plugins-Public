import type { ArchiveRead } from '@plugin-sdk/core';
import type { AttachmentItem } from '../shared/types';

const SNIPPET_CHARS = 60;
const HIT_LEAD_CHARS = 20;
interface TextRow { messageId: string; source: string; part: string | null; text: string }

/** Collapse space before slicing so a transcript's line breaks never consume its context budget. */
export function textSnippet(text: string, query: string): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  const hit = plain.toLowerCase().indexOf(query.replace(/\s+/g, ' ').toLowerCase());
  const start = Math.max(0, hit - HIT_LEAD_CHARS);
  const end = Math.min(plain.length, Math.max(start + SNIPPET_CHARS, hit + query.length));
  return `${start ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}

/** One indexed batch over the loaded messages, in the derived texts' stable order. */
export async function attachmentTextMatches(read: ArchiveRead, items: readonly Pick<AttachmentItem, 'id' | 'messageId' | 'filename'>[], query?: string): Promise<Map<string, NonNullable<AttachmentItem['textMatch']>>> {
  const matches = new Map<string, NonNullable<AttachmentItem['textMatch']>>();
  if (!query || !items.length) return matches;
  const texts = (await read(`SELECT message_id AS messageId, source, part, text FROM archive_derived_texts
    WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY message_id, ord, seq`, [JSON.stringify([...new Set(items.map((i) => i.messageId))])])) as TextRow[];
  const byMessage = new Map<string, TextRow[]>();
  for (const text of texts) {
    const rows = byMessage.get(text.messageId) ?? [];
    rows.push(text); byMessage.set(text.messageId, rows);
  }
  const needle = query.toLowerCase();
  for (const item of items) {
    if (item.filename.toLowerCase().includes(needle)) continue;
    const rows = byMessage.get(item.messageId) ?? [];
    const scoped = rows.some((r) => r.part !== null);
    const hit = rows.find((r) => (scoped ? r.part === `attachment:${item.id}` : r.part === null) && r.text.toLowerCase().includes(needle));
    if (hit) matches.set(item.id, { source: hit.source.startsWith('transcription:') ? 'transcript' : 'text', snippet: textSnippet(hit.text, query) });
  }
  return matches;
}
