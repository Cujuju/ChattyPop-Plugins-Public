import type { ArchiveRead } from '@plugin-sdk/core';
import type { EmojiStats } from '../shared/text';
import type { TextQuery } from './query';
import type { StatsRollups } from './rollups';
import { readTextStats } from './textRead';

export async function emojiStats(read: ArchiveRead, query: TextQuery, signal?: AbortSignal, rollups?: StatsRollups): Promise<EmojiStats> {
  return readTextStats(read, query, 'emoji', signal, rollups);
}

export const FALLBACK_EMOJI = /(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*)/gu;
