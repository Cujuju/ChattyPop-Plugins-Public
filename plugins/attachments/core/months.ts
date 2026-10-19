import type { ArchiveRead } from '@plugin-sdk/core';
import type { AttachmentFilter, AttachmentMonth } from '../shared/types';
import { monthBounds, monthReader } from '../shared/months';
import { ATTACHMENT_FROM, attachmentWhere } from './filters';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { aggregateSource } from './aggregateSource';
import type { AttachmentRollups } from './rollups';
import { COUNTS } from './rollups';

/**
 * Matching files per calendar month of `timeZone` (the viewer's, so a jump opens the month its dates show), newest
 * first. Months are bucketed here, not in SQL: SQLite knows only UTC and this process's own zone.
 */
export async function attachmentMonths(read: ArchiveRead, filter: AttachmentFilter, timeZone?: string, rollups?: AttachmentRollups): Promise<AttachmentMonth[]> {
  const monthAt = monthReader(timeZone);
  const s = aggregateSource(read, filter, rollups, false, true);
  if (!s.live) {
    const days = await s.read<{ ts: number; n: number }>(`SELECT CAST(a.ts / ${MS_PER_DAY} AS INTEGER) * ${MS_PER_DAY} AS ts,
      SUM(a.n) AS n ${s.from} WHERE ${s.where.sql} GROUP BY 1 HAVING SUM(a.n) > 0`, s.where.params);
    const counts = new Map<string, number>();
    const boundaries = new Map<number, { first: string; last: string; split: number }>();
    for (const day of days) {
      const month = monthAt(day.ts);
      const last = monthAt(day.ts + MS_PER_DAY - 1);
      if (month !== last) boundaries.set(day.ts, { first: month, last, split: monthBounds(month, timeZone)!.end });
      else counts.set(month, (counts.get(month) ?? 0) + day.n);
    }
    if (boundaries.size) {
      const w = attachmentWhere(filter);
      const branches = [...boundaries].map(([ts, boundary]) => `SELECT ${ts} AS ts,
        COUNT(CASE WHEN a.ts < ${boundary.split} THEN 1 END) AS before,
        COUNT(CASE WHEN a.ts >= ${boundary.split} THEN 1 END) AS after FROM (
        SELECT DISTINCT channel_id FROM ${COUNTS} UNION SELECT DISTINCT channel_id FROM archive_residual_attachments) rc
        JOIN archive_attachments a ON a.channel_id = rc.channel_id
        LEFT JOIN archive_channels c ON c.id = a.channel_id LEFT JOIN archive_guilds g ON g.id = c.guild_id
        WHERE ${w.sql} AND a.ts >= ? AND a.ts < ?`);
      const rows = await s.read<{ ts: number; before: number; after: number }>(branches.join(' UNION ALL '),
        [...boundaries.keys()].flatMap((ts) => [...w.params, ts, ts + MS_PER_DAY]));
      for (const row of rows) {
        const boundary = boundaries.get(row.ts)!;
        if (row.before) counts.set(boundary.first, (counts.get(boundary.first) ?? 0) + row.before);
        if (row.after) counts.set(boundary.last, (counts.get(boundary.last) ?? 0) + row.after);
      }
    }
    const result = [...counts].sort(([a], [b]) => b.localeCompare(a)).map(([month, count]) => ({ month, count }));
    return s.current() ? result : attachmentMonths(read, filter, timeZone);
  }
  const w = attachmentWhere(filter);
  const times = (await s.read(`SELECT a.ts AS ts ${ATTACHMENT_FROM} WHERE ${w.sql} ORDER BY a.ts`, [...w.params])) as { ts: number }[];
  const months: AttachmentMonth[] = [];
  let end = -Infinity;
  for (const { ts } of times) {
    if (ts >= end) {
      const month = monthAt(ts);
      end = monthBounds(month, timeZone)!.end;
      months.push({ month, count: 0 });
    }
    months.at(-1)!.count++;
  }
  return months.reverse();
}
