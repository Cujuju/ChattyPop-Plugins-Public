import { rollupRange, rollupView, type ArchiveRead, type CoreContext, type Rollup, type RollupRow } from '@plugin-sdk/core';
import { type Platform } from '@plugin-sdk/shared';
import { plugin } from '../shared';
import type { LinkFilter } from '../shared/types';

const VERSION = 1; // Platform counts partition by the canonical link's first share.
const COUNTS = rollupView(plugin, 'counts', VERSION);
export function defineLinkRollup(ctx: CoreContext): Rollup {
  return ctx.rollups.define('counts', {
    version: VERSION, columns: { platform: 'TEXT', n: 'INTEGER' }, key: ['platform'], dependsOn: ['links', 'edits', 'deletes'],
    compute: async (part, read) => read<RollupRow>(`SELECT platform, COUNT(*) AS n FROM archive_all_rollup_links
      WHERE first_channel_id = ? AND first_ts >= ? AND first_ts < ? GROUP BY platform`, [part.channelId, part.startTs, part.endTs]),
  });
}

/** Safety judgments are mutable plugin data; filtered counts use a background live read instead of persisting them. */
export async function rollupLinkCounts(read: ArchiveRead, f: LinkFilter, rollup: Rollup, live: () => Promise<Partial<Record<Platform, number>>>) {
  const snapshot = rollup.snapshot();
  if (f.hideFlagged || snapshot === null) return live();
  const { start, end, first, last } = rollupRange(f.sinceTs === undefined ? undefined : f.sinceTs + 1, f.untilTs === undefined ? undefined : f.untilTs + 1);
  const channels = f.channelId ? `channel_id IN (SELECT id FROM archive_channels WHERE id = ? OR (is_thread = 1 AND parent_id = ?))` : f.guildId ? 'channel_id IN (SELECT id FROM archive_channels WHERE guild_id = ?)' : '1';
  const bounds = [f.sinceTs === undefined ? '1' : `first_ts > ${f.sinceTs}`, f.untilTs === undefined ? '1' : `first_ts <= ${f.untilTs}`].join(' AND ');
  const rows = await read<{ platform: Platform; n: number }>(`SELECT platform, SUM(n) AS n FROM (
      SELECT channel_id, platform, n FROM ${COUNTS} WHERE day >= ? AND day < ?
      UNION ALL SELECT first_channel_id, platform, 1 FROM archive_links WHERE (first_ts < ${start} OR first_ts >= ${end}) AND ${bounds}
      UNION ALL SELECT first_channel_id, platform, 1 FROM archive_residual_links WHERE first_ts >= ${start} AND first_ts < ${end} AND ${bounds}
    ) WHERE ${channels} GROUP BY platform`, [first, last, ...(f.channelId ? [f.channelId, f.channelId] : f.guildId ? [f.guildId] : [])]);
  return rollup.snapshot() === snapshot ? Object.fromEntries(rows.map((r) => [r.platform, r.n])) : live();
}
