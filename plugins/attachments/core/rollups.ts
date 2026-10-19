import { rollupView, type CoreContext, type Rollup, type RollupRow } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { ON_DISK } from './filters';

export const ROLLUP_VERSION = 1; // Count and stored-hash grains share this schema revision.
export const COUNTS = rollupView(plugin, 'counts', ROLLUP_VERSION);
export const FILES = rollupView(plugin, 'files', ROLLUP_VERSION);
export const COUNT_ALL = rollupView(plugin, 'counts', ROLLUP_VERSION, 'all-time');
export const FILE_ALL = rollupView(plugin, 'files', ROLLUP_VERSION, 'all-time');
export interface AttachmentRollups { counts: Rollup; files: Rollup }

export function defineAttachmentRollups(ctx: CoreContext): AttachmentRollups {
  const data = {
    author: "COALESCE((SELECT author_id FROM archive_all_rollup_messages WHERE id = a.message_id), '')",
    stored: ON_DISK,
    bytes: "COALESCE(a.stored_bytes, a.size, 0)",
  };
  const counts = ctx.rollups.define('counts', {
    version: ROLLUP_VERSION, key: ['author_id', 'kind', 'stored', 'uncompressed'],
    columns: { author_id: 'TEXT', kind: 'TEXT', stored: 'INTEGER', uncompressed: 'INTEGER', n: 'INTEGER', ts: 'INTEGER', message_id: 'TEXT' },
    allTime: { values: { n: 'sum', ts: 'max', message_id: 'latest' }, orderBy: 'ts' },
    dependsOn: ['attachments', 'edits', 'deletes'], data,
    compute: async (part, read, _signal, data) => read<RollupRow>(`SELECT ${data.author} AS author_id, a.kind,
      (${data.stored}) AS stored, (${data.stored} AND a.kind IN ('image', 'video') AND a.compressed_at IS NULL) AS uncompressed,
      COUNT(*) AS n, MAX(a.ts) AS ts, a.message_id
      FROM archive_all_rollup_attachments a WHERE a.channel_id = ? AND a.ts >= ? AND a.ts < ? GROUP BY 1, 2, 3, 4`,
      [part.channelId, part.startTs, part.endTs]),
  });
  const files = ctx.rollups.define('files', {
    version: ROLLUP_VERSION, key: ['author_id', 'kind', 'uncompressed', 'sha256'],
    columns: { author_id: 'TEXT', kind: 'TEXT', uncompressed: 'INTEGER', sha256: 'TEXT', bytes: 'INTEGER' },
    allTime: { values: { bytes: 'max' } },
    indexes: [['sha256', 'bytes'], ['author_id', 'sha256', 'bytes']],
    dependsOn: ['attachments', 'edits', 'deletes'], data,
    compute: async (part, read, _signal, data) => read<RollupRow>(`SELECT ${data.author} AS author_id, a.kind,
      (a.kind IN ('image', 'video') AND a.compressed_at IS NULL) AS uncompressed, a.sha256, MAX(${data.bytes}) AS bytes
      FROM archive_all_rollup_attachments a WHERE a.channel_id = ? AND a.ts >= ? AND a.ts < ? AND ${data.stored}
      GROUP BY 1, 2, 3, 4`, [part.channelId, part.startTs, part.endTs]),
  });
  return { counts, files };
}
