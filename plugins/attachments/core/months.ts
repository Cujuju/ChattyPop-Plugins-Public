import type { ArchiveRead } from '@plugin-sdk/core';
import type { AttachmentFilter, AttachmentMonth } from '../shared/types';
import { monthBounds, monthOf } from '../shared/months';
import { ATTACHMENT_FROM, attachmentWhere } from './filters';

/**
 * Matching files per calendar month of `timeZone` (the viewer's, so a jump opens the month its dates show), newest
 * first. Months are bucketed here, not in SQL: SQLite knows only UTC and this process's own zone.
 */
export async function attachmentMonths(read: ArchiveRead, filter: AttachmentFilter, timeZone?: string): Promise<AttachmentMonth[]> {
  const w = attachmentWhere(filter);
  const times = (await read(`SELECT a.ts AS ts ${ATTACHMENT_FROM} WHERE ${w.sql} ORDER BY a.ts`, [...w.params])) as { ts: number }[];
  const months: AttachmentMonth[] = [];
  let end = -Infinity;
  for (const { ts } of times) {
    if (ts >= end) {
      const month = monthOf(ts, timeZone);
      end = monthBounds(month, timeZone)!.end;
      months.push({ month, count: 0 });
    }
    months.at(-1)!.count++;
  }
  return months.reverse();
}
