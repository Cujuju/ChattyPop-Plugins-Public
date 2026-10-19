import type { ArchiveRead } from '@plugin-sdk/core';
import type { ActivityQuery } from '../shared/types';
import type { VoiceStats } from '../shared/voice';
import type { StatsRollups } from './rollups';
import { projectCounts } from './countRead';

export async function voiceStats(read: ArchiveRead, query: ActivityQuery, rollups?: StatsRollups): Promise<VoiceStats> {
  return projectCounts(read, query, 'voiceStats', rollups);
}
