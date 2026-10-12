import type { PluginDb } from '@plugin-sdk/core';
import type { ActivityStats } from '../shared/types';
import type { StatsSqlScope } from './query';

type Totals = Pick<ActivityStats, 'messages' | 'authors' | 'editedMessages' | 'textMessages' | 'attachmentMessages'> & {
  firstTs: number | null;
  lastTs: number | null;
};

export function totals(db: PluginDb, scope: StatsSqlScope): Totals {
  return db.prepare(`SELECT COUNT(*) AS messages, COUNT(DISTINCT m.author_id) AS authors,
    COUNT(CASE WHEN m.edited_ts IS NOT NULL THEN 1 END) AS editedMessages,
    COUNT(CASE WHEN trim(m.content, char(9) || char(10) || char(13) || ' ') != '' THEN 1 END) AS textMessages,
    COUNT(CASE WHEN EXISTS (SELECT 1 FROM archive_attachments a WHERE a.message_id = m.id) THEN 1 END) AS attachmentMessages,
    MIN(m.ts) AS firstTs, MAX(m.ts) AS lastTs
    FROM archive_messages m WHERE ${scope.sql}`).get(...scope.params) as Totals;
}
