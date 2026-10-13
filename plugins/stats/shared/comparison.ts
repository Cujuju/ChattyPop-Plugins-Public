import type { ActivityStats } from './types';

export type OverviewTotals = Pick<ActivityStats,
  'messages' | 'authors' | 'activeDays' | 'editedMessages' | 'textMessages' | 'linkedMessages' | 'attachmentMessages'>;

export interface PeriodComparison {
  start: number;
  end: number;
  /** Null when the visible archive does not reach the preceding period's start. */
  totals: OverviewTotals | null;
}
