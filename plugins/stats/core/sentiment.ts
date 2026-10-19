import type { ArchiveRead } from '@plugin-sdk/core';
import type { SentimentStats } from '../shared/text';
import type { TextQuery } from './query';
import type { StatsRollups } from './rollups';
import { readTextStats } from './textRead';

export async function sentimentStats(read: ArchiveRead, query: TextQuery, signal?: AbortSignal, rollups?: StatsRollups): Promise<SentimentStats> {
  return readTextStats(read, query, 'sentiment', signal, rollups);
}
