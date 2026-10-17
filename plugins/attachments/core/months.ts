import type { PluginDb } from '@plugin-sdk/core';
import { MS_PER_S } from '@plugin-sdk/shared';
import type { AttachmentFilter, AttachmentMonth } from '../shared/types';
import { ATTACHMENT_FROM, attachmentWhere } from './filters';

export function attachmentMonths(db: PluginDb, filter: AttachmentFilter): AttachmentMonth[] {
  const w = attachmentWhere(filter);
  return db.prepare(`SELECT strftime('%Y-%m', a.ts / ${MS_PER_S}, 'unixepoch', 'localtime') AS month, COUNT(*) AS count
    ${ATTACHMENT_FROM} WHERE ${w.sql} GROUP BY month ORDER BY month DESC`).all(...w.params) as AttachmentMonth[];
}
