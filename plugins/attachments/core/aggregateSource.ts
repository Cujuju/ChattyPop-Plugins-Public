import type { ArchiveRead } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import type { AttachmentFilter } from '../shared/types';
import { ATTACHMENT_FROM, AUTHOR_ID, DISK_BYTES, ON_DISK, attachmentWhere } from './filters';
import { COUNTS, FILES, COUNT_ALL, FILE_ALL, type AttachmentRollups } from './rollups';
import { aggregateWhere } from './aggregateWhere';

const FIRST_TS = 0; // Discord archive timestamps are after the Unix epoch.
const LAST_TS = Number.MAX_SAFE_INTEGER; // An omitted upper bound includes every representable archive millisecond.
const FIRST_DAY = '0000-01-01'; // Unbounded range sentinel sorts before every Discord UTC date.
const LAST_DAY = '9999-12-31'; // Unbounded range sentinel sorts after every Discord UTC date.

export function wholeDays(f: { sinceTs?: number; untilTs?: number }) {
  for (const ts of [f.sinceTs, f.untilTs]) if (ts !== undefined && !Number.isFinite(ts)) throw new Error('Invalid rollup range');
  const start = f.sinceTs === undefined ? FIRST_TS : Math.ceil((f.sinceTs + 1) / MS_PER_DAY) * MS_PER_DAY;
  const end = f.untilTs === undefined ? LAST_TS : Math.floor((f.untilTs + 1) / MS_PER_DAY) * MS_PER_DAY;
  const first = f.sinceTs === undefined ? FIRST_DAY : new Date(start).toISOString().slice(0, 10);
  const last = f.untilTs === undefined ? LAST_DAY : new Date(end).toISOString().slice(0, 10);
  return { start, end, sql: `day >= '${first}' AND day < '${last}'` };
}

/** Unsupported text, size and duplicate filters use the original visible archive at background priority. */
export function aggregateSource(read: ArchiveRead, filter: AttachmentFilter, rollups?: AttachmentRollups, disk = true, byDay = false) {
  const capable = rollups && !filter.name && filter.minBytes === undefined && !filter.repeated;
  const counts = capable ? rollups.counts.snapshot() : null;
  const files = capable ? rollups.files.snapshot() : null;
  const usable = counts !== null && files !== null;
  const queryRead: ArchiveRead = usable ? read : (sql, params, options) => read(sql, params, { ...options, priority: 'background' });
  if (!usable) return { read: queryRead, from: ATTACHMENT_FROM, where: attachmentWhere(filter), count: 'COUNT(*)', n: '1', author: AUTHOR_ID, bytes: DISK_BYTES, live: true, current: () => true };
  const range = wholeDays(filter);
  const bounded = filter.sinceTs !== undefined || filter.untilTs !== undefined;
  const countSource = bounded || byDay ? `SELECT * FROM ${COUNTS} WHERE ${range.sql}` : `SELECT * FROM ${COUNT_ALL}`;
  const fileSource = bounded || byDay ? `SELECT * FROM ${FILES} WHERE ${range.sql}` : `SELECT * FROM ${FILE_ALL}`;
  const liveColumns = `a.channel_id, ${AUTHOR_ID} AS author_id, a.kind, (${ON_DISK}) AS stored,
    (${ON_DISK} AND a.kind IN ('image', 'video') AND a.compressed_at IS NULL) AS uncompressed,
    a.sha256, ${DISK_BYTES} AS bytes, a.ts, a.message_id, 1 AS n`;
  const boundaryFrom = `FROM (SELECT DISTINCT channel_id FROM ${COUNTS}) rc
    CROSS JOIN archive_rollup_attachments a ON a.channel_id = rc.channel_id`;
  const boundaryParts = [
    ...(filter.sinceTs === undefined ? [] : [`SELECT ${liveColumns} ${boundaryFrom} WHERE a.ts > ${filter.sinceTs} AND a.ts < ${range.start}`]),
    ...(filter.untilTs === undefined ? [] : [`SELECT ${liveColumns} ${boundaryFrom} WHERE a.ts >= ${Math.max(range.start, range.end)} AND a.ts <= ${filter.untilTs}`]),
  ];
  const boundaries = bounded ? boundaryParts.join(' UNION ALL ') + ' UNION ALL ' : '';
  const live = `${boundaries}SELECT ${liveColumns} FROM archive_residual_attachments a`;
  const bounds = [filter.sinceTs === undefined ? '1' : `a.ts > ${filter.sinceTs}`, filter.untilTs === undefined ? '1' : `a.ts <= ${filter.untilTs}`].join(' AND ');
  const source = `SELECT channel_id, author_id, kind, stored, uncompressed,
      NULL AS sha256, 0 AS bytes, ts, message_id, n FROM (${countSource})
    ${disk ? `UNION ALL SELECT channel_id, author_id, kind, 1, uncompressed, sha256, bytes, NULL, NULL, 0 FROM (${fileSource})` : ''}
    UNION ALL SELECT * FROM (${live}) a WHERE ${bounds}`;
  // Boundary/residual rows retain exact timestamps; file-hash rows carry no counts and bypass timestamp filtering.
  const from = `FROM (${source}) a LEFT JOIN archive_channels c ON c.id = a.channel_id LEFT JOIN archive_guilds g ON g.id = c.guild_id`;
  return { read: queryRead, from, where: aggregateWhere(filter), count: 'SUM(a.n)', n: 'a.n', author: 'a.author_id', bytes: 'a.bytes', live: false,
    current: () => rollups!.counts.snapshot() === counts && rollups!.files.snapshot() === files };
}
