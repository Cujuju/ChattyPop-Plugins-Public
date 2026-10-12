import type { PluginDb } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { ATTACHMENT_KINDS, EDIT_DELAY_BUCKETS, type ActivityStats } from '../shared/types';
import { local, type StatsSqlScope } from './query';

/** Spans longer than four months use weekly bars to remain legible. */
export const DAY_BUCKETS_MAX_DAYS = 120;
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const MONDAY_BACKSTEP_DAYS = DAYS_PER_WEEK - 1;
const MONDAY_WEEKDAY = 1;

export function messageCharts(db: PluginDb, scope: StatsSqlScope, start: number | null, last: number | null) {
  const spanDays = start === null || last === null ? 0 : (last - start) / MS_PER_DAY;
  const bucket = spanDays > DAY_BUCKETS_MAX_DAYS ? 'week' : 'day';
  const startSql = bucket === 'day' ? `date(${local('m.ts')})`
    : `date(${local('m.ts')}, '-${MONDAY_BACKSTEP_DAYS} days', 'weekday ${MONDAY_WEEKDAY}')`;
  const buckets = db.prepare(`SELECT ${startSql} AS start, COUNT(*) AS count FROM archive_messages m
    WHERE ${scope.sql} GROUP BY start ORDER BY start`).all(...scope.params) as ActivityStats['buckets'];
  const heatmap = Array.from({ length: DAYS_PER_WEEK }, () => new Array<number>(HOURS_PER_DAY).fill(0));
  const cells = db.prepare(`SELECT CAST(strftime('%w', ${local('m.ts')}) AS INTEGER) AS wd,
    CAST(strftime('%H', ${local('m.ts')}) AS INTEGER) AS hr, COUNT(*) AS n FROM archive_messages m
    WHERE ${scope.sql} GROUP BY wd, hr`).all(...scope.params) as { wd: number; hr: number; n: number }[];
  for (const c of cells) heatmap[c.wd]![c.hr] = c.n;
  return { bucket, buckets, heatmap } as const;
}

export function editDelay(db: PluginDb, scope: StatsSqlScope): ActivityStats['editDelay'] {
  const branches = EDIT_DELAY_BUCKETS.filter((b) => b.beforeMs !== null)
    .map((b) => `WHEN m.edited_ts - m.ts < ${b.beforeMs} THEN '${b.id}'`).join(' ');
  const lastBucket = EDIT_DELAY_BUCKETS.at(-1)!;
  const rows = db.prepare(`SELECT CASE ${branches} ELSE '${lastBucket.id}' END AS bucketId, COUNT(*) AS count
    FROM archive_messages m WHERE ${scope.sql} AND m.edited_ts IS NOT NULL GROUP BY bucketId`)
    .all(...scope.params) as { bucketId: string; count: number }[];
  return EDIT_DELAY_BUCKETS.map((b) => ({ id: b.id, count: rows.find((r) => r.bucketId === b.id)?.count ?? 0 }));
}

export function attachmentTypes(db: PluginDb, scope: StatsSqlScope): ActivityStats['attachmentTypes'] {
  const rows = db.prepare(`SELECT CASE
    WHEN lower(a.content_type) LIKE 'image/%' THEN 'image'
    WHEN lower(a.content_type) LIKE 'video/%' THEN 'video'
    WHEN lower(a.content_type) LIKE 'audio/%' THEN 'audio'
    ELSE 'other' END AS kind, COUNT(*) AS count
    FROM archive_attachments a JOIN archive_messages m ON m.id = a.message_id
    WHERE ${scope.sql} GROUP BY kind`).all(...scope.params) as ActivityStats['attachmentTypes'];
  return ATTACHMENT_KINDS.map((kind) => ({ kind, count: rows.find((r) => r.kind === kind)?.count ?? 0 }));
}
