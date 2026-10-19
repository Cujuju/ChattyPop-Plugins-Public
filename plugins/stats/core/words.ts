import type { ArchiveRead } from '@plugin-sdk/core';
import type { WordStats } from '../shared/text';
import type { TextQuery } from './query';
import type { StatsRollups } from './rollups';
import { readTextStats } from './textRead';

export async function wordStats(read: ArchiveRead, query: TextQuery, signal?: AbortSignal, rollups?: StatsRollups): Promise<WordStats> {
  return readTextStats(read, query, 'words', signal, rollups);
}
