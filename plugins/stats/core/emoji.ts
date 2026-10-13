import type { PluginDb } from '@plugin-sdk/core';
import { STATS_TOP, type ActivityQuery } from '../shared/types';
import type { EmojiCount, EmojiStats } from '../shared/text';
import { scanText } from './scan';
import { CUSTOM_EMOJI } from './tokenize';
import { rankedTop } from './rankedTop';

/** The fallback also keeps flags and keycaps whole; pictographs retain modifiers and joined components. */
export const FALLBACK_EMOJI = /(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*)/gu;

function unicodePattern(): { pattern: RegExp; name: EmojiStats['unicodeMatcher'] } {
  try { return { pattern: new RegExp('\\p{RGI_Emoji}', 'gv'), name: 'RGI_Emoji' }; }
  catch { return { pattern: FALLBACK_EMOJI, name: 'Extended_Pictographic' }; }
}

export async function emojiStats(db: PluginDb, query: ActivityQuery): Promise<EmojiStats> {
  const unicode = unicodePattern();
  const counts = new Map<string, EmojiCount>();
  const firstSequences = new Map<string, number>();
  const firstPositions = new Map<string, number>();
  let customCount = 0;
  let unicodeCount = 0;
  const add = (key: string, emoji: Omit<EmojiCount, 'count'>, seq: number, position: number): void => {
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
      // Metadata still comes from the first ingested use, independent of the scan's channel/time order.
      if (seq < firstSequences.get(key)!) Object.assign(existing, emoji);
    } else counts.set(key, { ...emoji, count: 1 });
    if (!firstSequences.has(key) || seq < firstSequences.get(key)!) firstPositions.set(key, position);
    firstSequences.set(key, Math.min(firstSequences.get(key) ?? seq, seq));
  };
  const textMessages = await scanText(db, query, ({ content, seq }) => {
    let position = 0;
    for (const match of content.matchAll(CUSTOM_EMOJI)) {
      add(`custom:${match[3]}`, { id: match[3]!, name: match[2]!, animated: match[1] === 'a' }, seq, position++);
      customCount++;
    }
    for (const match of content.replace(CUSTOM_EMOJI, ' ').matchAll(unicode.pattern)) {
      add(`unicode:${match[0]}`, { id: null, name: match[0], animated: false }, seq, position++);
      unicodeCount++;
    }
  });
  return {
    textMessages, custom: customCount, unicode: unicodeCount, unicodeMatcher: unicode.name,
    emoji: rankedTop(counts, STATS_TOP, ([aKey, a], [bKey, b]) => b.count - a.count || (a.id ?? a.name).localeCompare(b.id ?? b.name)
      || firstSequences.get(aKey)! - firstSequences.get(bKey)! || firstPositions.get(aKey)! - firstPositions.get(bKey)!).map(([, emoji]) => emoji),
  };
}
