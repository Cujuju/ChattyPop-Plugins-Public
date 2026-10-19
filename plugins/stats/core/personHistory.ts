import type { ArchiveRead } from '@plugin-sdk/core';
import type { ActivityQuery } from '../shared/types';
import type { PersonHistory, PeopleStats } from '../shared/personHistory';
import type { StatsRollups } from './rollups';
import { projectCounts } from './countRead';

export async function personHistory(read: ArchiveRead, query: ActivityQuery, rollups?: StatsRollups): Promise<PersonHistory> {
  return projectCounts(read, query, 'personHistory', rollups);
}
export async function peopleStats(read: ArchiveRead, query: ActivityQuery, rollups?: StatsRollups): Promise<PeopleStats> {
  return projectCounts(read, query, 'peopleStats', rollups);
}
