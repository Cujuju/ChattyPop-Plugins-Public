import type { PluginDb } from '@plugin-sdk/core';
import { ATTACHMENT_KINDS, EDIT_DELAY_BUCKETS, type ActivityStats } from '../shared/types';
import type { StatsSqlScope } from './query';

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
    WHERE ${scope.sql} GROUP BY 1`).all(...scope.params) as ActivityStats['attachmentTypes'];
  return ATTACHMENT_KINDS.map((kind) => ({ kind, count: rows.find((r) => r.kind === kind)?.count ?? 0 }));
}
