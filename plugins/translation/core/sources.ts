// Collects translatable part text from image readings, transcripts, embeds, and linked posts absent from cards, with each part's kind.
import { createHash } from 'node:crypto';
import type { MessagePart, PartText } from '@plugin-sdk/core';
import type { SourceKind } from '../shared/types';
import type { QueuedSource } from './store';

/** A part's text to translate. `hash`: of the target language and the text, so either changing translates it again. */
export interface PartSource extends QueuedSource {
  text: string;
}

/** Joins two plugins' texts of one part. */
const TEXT_SEPARATOR = '\n\n';

export const sourceHash = (language: string, text: string): string => createHash('sha256').update(`${language}
${text}`).digest('hex');

const kindOf = (p: MessagePart): SourceKind => (p.kind === 'text' ? 'embed-text' : p.kind === 'image' ? 'image-text' : 'transcript');

/** Orders translation sources by displayed parts. Excludes ownId's derived texts and texts naming removed parts. */
export function messageSources(ownId: string, language: string, parts: ReadonlyMap<string, readonly MessagePart[]>, texts: readonly PartText[]): Map<string, PartSource[]> {
  const byPart = new Map<string, string[]>();
  for (const t of texts) {
    if (t.pluginId === ownId) continue;
    const id = `${t.messageId}\n${t.part}`;
    byPart.set(id, [...(byPart.get(id) ?? []), t.text]);
  }
  const out = new Map<string, PartSource[]>();
  for (const [messageId, list] of parts) {
    const sources = list.flatMap((p): PartSource[] => {
      const text = p.kind === 'text' ? p.text : byPart.get(`${messageId}\n${p.key}`)?.join(TEXT_SEPARATOR);
      return text?.trim() ? [{ key: p.key, kind: kindOf(p), text, hash: sourceHash(language, text) }] : [];
    });
    if (sources.length) out.set(messageId, sources);
  }
  return out;
}
