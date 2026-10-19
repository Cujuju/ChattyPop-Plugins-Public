import { rollupView, type ArchiveRead } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { plugin } from '../shared';
import { CONVERSATION_GAP_MS, CONVERSATION_PAIRS, REPLY_MIN_RUNS, type ConversationStats } from '../shared/conversations';
import { everyoneQuery, STATS_TOP, type ActivityQuery } from '../shared/types';
import { cachedStats } from './readCache';
import { scopeSql } from './stats';
import { ROLLUP_VERSION, type StatsRollups } from './rollups';
import { runWork, RUN_PAGE_SIZE } from './runWork';
import { runReadWork } from './runReadWork';
import { conversationProjection } from './conversationProjection';
import { createConversationRoles } from './conversationRoles';
import { median } from './median';

export const RUN_DATA = { gapMs: CONVERSATION_GAP_MS, pageSize: RUN_PAGE_SIZE };
const RUN_VIEW = rollupView(plugin, 'runs', ROLLUP_VERSION);

export async function projectRuns(read: ArchiveRead, query: ActivityQuery, rollups?: StatsRollups): Promise<ConversationStats> {
  const q = { ...everyoneQuery(query), sinceTs: null };
  const scope = await scopeSql(read, q);
  const channelIds = q.scope === 'all' ? undefined : (await read<{ channel_id: string }>(
    `SELECT m.id AS channel_id FROM archive_all_channels m WHERE ${scope.sql.replaceAll('m.channel_id', 'm.id')}`, scope.params)).map((r) => r.channel_id);
  // Include an explicitly requested channel even when its metadata has not arrived.
  if (channelIds && q.scope === 'channel' && q.channelId && !channelIds.includes(q.channelId)) channelIds.push(q.channelId);
  const firstDay = query.sinceTs === null ? undefined : new Date(Math.floor(query.sinceTs / MS_PER_DAY) * MS_PER_DAY).toISOString().slice(0, 'YYYY-MM-DD'.length);
  const snapshotScope = { channelIds, firstDay };
  const token = rollups?.runs?.snapshot(snapshotScope);
  const current = () => Boolean(token && rollups!.runs!.snapshot(snapshotScope) === token);
  const load = async (view?: string) => (await read<ConversationStats>('SELECT 1', [], { priority: view ? 'interactive' : 'background', fold: {
    source: runReadWork.toString(), data: { ...RUN_DATA, sql: scope.sql, params: scope.params, view, firstDay,
      rowsSql: `SELECT * FROM ${RUN_VIEW} m WHERE ${scope.sql} ${firstDay ? 'AND m.day >= ?' : ''}`, rowsParams: [...scope.params, ...(firstDay ? [firstDay] : [])],
      compute: runWork.toString(), projector: conversationProjection.toString(),
      config: { query, pairLimit: CONVERSATION_PAIRS, roles: createConversationRoles.toString(),
        roleConfig: { top: STATS_TOP, minRuns: REPLY_MIN_RUNS, median: median.toString() } } },
  } }))[0]!;
  // Cache bounded projections; author filters affect the projection and never duplicate stored run histories on Core.
  return cachedStats(read, token ? JSON.stringify(['conversations', scope, query.sinceTs, query.authorId ?? null, token]) : null, current, async () => {
    const value = await load(token ? RUN_VIEW : undefined);
    return token && !current() ? load() : value;
  }).then((value) => ({ ...value, query }));
}
