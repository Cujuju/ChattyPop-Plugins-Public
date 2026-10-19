import type { ArchiveRead } from '@plugin-sdk/core';
import type { RepeatedLinksStats } from '../shared/repeatedLinks';
import type { ActivityQuery } from '../shared/types';
import type { StatsRollups } from './rollups';
import { projectCounts } from './countRead';

export async function repeatedLinks(read: ArchiveRead, query: ActivityQuery, rollups?: StatsRollups): Promise<RepeatedLinksStats> {
  return projectCounts(read, query, 'repeatedLinks', rollups);
}
