import type { PluginDb } from '@plugin-sdk/core';
import type { PeriodComparison, OverviewTotals } from '../shared/comparison';
import { TOTAL_COLUMNS } from './overview';
import { local, type StatsSqlScope } from './query';
import { LINKED_MESSAGE } from './stats';

/** The preceding interval is bounded internally; the public query retains only its lower bound. */
export function periodComparison(db: PluginDb, wholeScope: StatsSqlScope, sinceTs: number | null,
  archivedSince: number | null, now: number): PeriodComparison | null {
  if (sinceTs === null || sinceTs >= now) return null;
  const start = sinceTs - (now - sinceTs);
  if (archivedSince === null || archivedSince > start) return { start, end: sinceTs, totals: null };
  const bounded = `${wholeScope.sql} AND m.ts >= ? AND m.ts < ?`;
  const totals = db.prepare(`SELECT ${TOTAL_COLUMNS}, COUNT(DISTINCT date(${local('m.ts')})) AS activeDays,
    COUNT(CASE WHEN ${LINKED_MESSAGE} THEN 1 END) AS linkedMessages
    FROM archive_messages m WHERE ${bounded}`).get(...wholeScope.params, start, sinceTs) as OverviewTotals;
  return { start, end: sinceTs, totals };
}
