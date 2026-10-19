import { rollupRange, rollupView, type ArchiveRead } from '@plugin-sdk/core';
import { POSTERS_TOP, STATS_TOP, ATTACHMENT_KINDS, EDIT_DELAY_BUCKETS, type ActivityQuery } from '../shared/types';
import { countWork } from './countWork';
import { COUNT_DATA, COUNT_VIEW, ROLLUP_VERSION, type StatsRollups } from './rollups';
import { plugin } from '../shared';
import { scopeSql } from './stats';
import { cachedStats } from './readCache';
import { countProjection } from './countProjection';
import { PERSON_SILENCE_DAYS, QUIET_MIN_MESSAGES } from '../shared/personHistory';
import { VOICE_PEOPLE } from '../shared/voice';
import { REPEATED_LINK_MIN_SHARES } from '../shared/repeatedLinks';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import type { TextQuery } from './query';


const SHARE_VIEW = rollupView(plugin, 'shares', ROLLUP_VERSION);
const SHARE_ALL = rollupView(plugin, 'shares', ROLLUP_VERSION, 'all-time');
const WEEK_DAYS = 7; // Calendar weeks contain seven local days.
const DAY_HOURS = 24; // Heatmap columns cover the local clock's twenty-four hours.
const DAY_BUCKETS_MAX_DAYS = 120; // Four months is the existing chart's switch to weekly bars.
const PEOPLE_MEMBERS = new Set(['peopleStats', 'personHistory', 'voiceStats']);

export async function projectCounts<T>(read: ArchiveRead, query: TextQuery, member: string, rollups?: StatsRollups, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const q = PEOPLE_MEMBERS.has(member) ? { ...query, authorId: null } : query;
  const scope = await scopeSql(read, { ...q, sinceTs: null, ...(q.scope === 'channels' ? { untilTs: null } : {}) });
  signal?.throwIfAborted();
  const countToken = rollups?.counts.snapshot(), shareToken = rollups?.links.snapshot(), now = Date.now();
  const token = countToken && shareToken ? countToken + '/' + shareToken : null;
  const cuts = [...(query.sinceTs === null ? [] : [query.sinceTs, query.sinceTs - (now - query.sinceTs), now]),
    ...(query.scope === 'channels' && query.untilTs !== null ? [query.untilTs + 1] : [])];
  const needsLinks = member === 'activityStats' || member === 'repeatedLinks';
  const shares = query.sinceTs === null ? SHARE_ALL : SHARE_VIEW;
  const columns = 'm.author_id, m.date, m.kind, m.url, m.n, m.text_n, m.edited_n, m.attachment_n, m.linked_n, m.first_ts, m.last_ts, m.first_id, m.name, m.payload';
  const rowsSql = `SELECT m.channel_id, m.day, ${columns} FROM ${COUNT_VIEW} m WHERE ${scope.sql} AND m.day NOT IN (SELECT value FROM json_each(?))`
    + (needsLinks ? ` UNION ALL SELECT m.channel_id, ${query.sinceTs === null ? 'NULL' : 'm.day'}, ${columns} FROM ${shares} m WHERE ${scope.sql}`
      + (query.sinceTs === null ? '' : ' AND m.day NOT IN (SELECT value FROM json_each(?))') : '');
  const days = JSON.stringify([...new Set(cuts.flatMap((ts) => rollupRange(ts, ts).boundaryDays))]);
  const rowsParams = [...scope.params, days, ...(needsLinks ? [...scope.params, ...(query.sinceTs === null ? [] : [days])] : [])];
  const load = async (view?: string) => (await read<T>('SELECT 1', [], { signal, priority: view ? 'interactive' : 'background', fold: {
    source: countWork.toString(), data: { ...COUNT_DATA, timeZone, mode: 'read', sql: scope.sql, params: scope.params, cuts, view, rowsSql, rowsParams, channelsSql: `SELECT DISTINCT m.channel_id FROM ${COUNT_VIEW} m WHERE ${scope.sql}`,
      projector: countProjection.toString(), config: { query, member, now, timeZone, dayMs: MS_PER_DAY, weekDays: WEEK_DAYS, dayHours: DAY_HOURS,
        maxDayBuckets: DAY_BUCKETS_MAX_DAYS, top: STATS_TOP, postersTop: POSTERS_TOP, editIds: EDIT_DELAY_BUCKETS.map((b) => b.id), kinds: ATTACHMENT_KINDS,
        silenceDays: PERSON_SILENCE_DAYS, quietMin: QUIET_MIN_MESSAGES, voicePeople: VOICE_PEOPLE, minShares: REPEATED_LINK_MIN_SHARES } },
  } }))[0]!;
  const current = () => Boolean(token && rollups!.counts.snapshot() + '/' + rollups!.links.snapshot() === token);
  return cachedStats(read, token ? JSON.stringify([member, query, token, member === 'activityStats' && query.sinceTs !== null ? now : null]) : null, current, async () => {
    const result = await load(token ? COUNT_VIEW : undefined);
    return token && !current() ? load() : result;
  });
}
