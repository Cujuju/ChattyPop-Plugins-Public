import type { ArchiveRead } from '@plugin-sdk/core';
import type { ConversationStats } from '../shared/conversations';
import type { ActivityQuery } from '../shared/types';
import { projectRuns } from './runRead';
import type { StatsRollups } from './rollups';

export function conversationStats(read: ArchiveRead, query: ActivityQuery, rollups?: StatsRollups): Promise<ConversationStats> {
  return projectRuns(read, query, rollups);
}
