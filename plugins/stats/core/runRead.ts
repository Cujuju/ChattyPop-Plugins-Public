import { rollupView, type ArchiveRead } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { plugin } from '../shared';
import { CONVERSATION_GAP_MS } from '../shared/conversations';
import { everyoneQuery, type ActivityQuery } from '../shared/types';
import { cachedStats } from './readCache';
import { scopeSql } from './stats';
import { ROLLUP_VERSION, type StatsRollups } from './rollups';
import { runWork, RUN_PAGE_SIZE, type StoredRun } from './runWork';

export const RUN_DATA = { gapMs: CONVERSATION_GAP_MS, pageSize: RUN_PAGE_SIZE };
const RUN_VIEW = rollupView(plugin, 'runs', ROLLUP_VERSION);

export async function runRows(read: ArchiveRead, query: ActivityQuery, rollups?: StatsRollups): Promise<StoredRun[]> {
  const q = { ...everyoneQuery(query), sinceTs: null };
  const scope = await scopeSql(read, q);
  const token = rollups?.runs?.snapshot();
  const day = query.sinceTs === null ? null : new Date(Math.floor(query.sinceTs / MS_PER_DAY) * MS_PER_DAY).toISOString().slice(0, 'YYYY-MM-DD'.length);
  const live = () => read<StoredRun>('SELECT 1', [], { priority: 'background', fold: { source: runWork.toString(), data: { ...RUN_DATA, sql: scope.sql, params: scope.params } } });
  if (!token) return live();
  const current = () => rollups!.runs!.snapshot() === token;
  return cachedStats(read, JSON.stringify(['runs', query, token]), current, async () => {
    const residual = await read(`SELECT 1 FROM archive_residual_messages m WHERE ${scope.sql} LIMIT 1`, scope.params);
    if (residual.length) return live();
    const rows = await read<StoredRun>(`SELECT * FROM ${RUN_VIEW} m WHERE ${scope.sql} ${day === null ? '' : 'AND m.day >= ?'}`,
      [...scope.params, ...(day === null ? [] : [day])]);
    return current() ? rows : live();
  });
}
