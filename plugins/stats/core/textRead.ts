import { rollupView, ROLLUP_FIRST_DAY, ROLLUP_LAST_DAY, type ArchiveRead } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import { afinn165 } from 'afinn-165';
import { en } from 'stopwords-iso/stopwords-iso.json';
import { plugin } from '../shared';
import { STATS_TOP } from '../shared/types';
import { CLOUD_WORDS, MIN_WORD_LENGTH } from '../shared/text';
import { MESSAGE_WORD_BUCKETS, WORDS_PERSON_MIN_MESSAGES } from '../shared/messageLength';
import { WORD_RATE_BASE, WORD_TREND_MIN_USES, WORD_TREND_TOP } from '../shared/wordTrends';
import { scopeSql } from './stats';
import { TEXT_ROLLUP_VERSION, type StatsRollups } from './rollups';
import { textWork } from './textWork';
import { cachedStats } from './readCache';
import { textReadWork } from './textReadWork';
import type { TextQuery } from './query';
import { summaryRowsSql } from './summaryRows';
import { textIndexRead } from './textIndexRead';
import { TEXT_INDEX, textIndexSql } from './textIndexSql';
import { AnalyticsPending } from './pending';

const HALVES = 2; // Midpoints and even-sample medians divide their interval into two halves.
const WEEK_DAYS = 7; // Weekly charts start on Monday in the viewer's local calendar.
const DAY_BUCKETS_MAX_DAYS = 120; // Existing charts use weeks beyond four months.
export const TEXT_DATA = { afinn: afinn165, top: STATS_TOP };
export const TEXT_VIEW = rollupView(plugin, 'text', TEXT_ROLLUP_VERSION);

export async function readTextStats<T>(read: ArchiveRead, query: TextQuery, section: 'words' | 'emoji' | 'sentiment', signal?: AbortSignal, rollups?: StatsRollups): Promise<T> {
  signal?.throwIfAborted();
  const scope = await scopeSql(read, query);
  const members = await scopeSql(read, { ...query, sinceTs: null, ...(query.scope === 'channels' ? { untilTs: null } : {}) });
  const token = rollups?.text?.snapshot();
  if (rollups && !token) throw new AnalyticsPending();
  const cuts = [query.sinceTs, query.scope === 'channels' ? query.untilTs === null ? null : query.untilTs + 1 : null].filter((ts): ts is number => ts !== null);
  const kinds = section === 'words' ? '1' : section === 'sentiment' ? "m.kind IN ('extent', 'lengths')" : "m.kind IN ('extent', 'lengths', 'emoji')";
  const bounds = [query.sinceTs === null ? '1' : `m.day >= '${new Date(query.sinceTs).toISOString().slice(0, 'YYYY-MM-DD'.length)}'`,
    query.scope !== 'channels' || query.untilTs === null ? '1' : `m.day <= '${new Date(query.untilTs).toISOString().slice(0, 'YYYY-MM-DD'.length)}'`].join(' AND ');
  const columns = section === 'words' ? '*' : 'm.kind, m.date, m.term, m.n, m.first_ts, m.last_ts, m.seq, m.position, m.payload';
  const source = `SELECT ${columns} FROM ${TEXT_VIEW} m WHERE ${kinds} AND ${members.sql} AND ${bounds} AND m.day NOT IN (SELECT value FROM json_each(?))`;
  const rowsSql = section === 'words' ? source : summaryRowsSql(source, section === 'emoji');
  const load = async (view?: string) => (await read<T>('SELECT 1', [], { signal, priority: view ? 'interactive' : 'background', fold: {
    source: textReadWork.toString(), data: { compute: textWork.toString(), config: { ...TEXT_DATA, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, view, sql: scope.sql, params: scope.params,
      rowsSql, channelsSql: query.authorId == null ? `SELECT DISTINCT m.channel_id FROM ${TEXT_INDEX} m WHERE m.kind = 'extent' AND m.author_id = '' AND ${members.sql}`
        : `SELECT DISTINCT m.channel_id FROM ${TEXT_VIEW} m WHERE m.kind = 'extent' AND ${members.sql}`, memberSql: members.sql, memberParams: members.params, section, cuts, sinceTs: query.sinceTs,
      untilTs: query.scope === 'channels' && query.untilTs !== null ? query.untilTs + 1 : null,
      indexView: view && query.authorId == null ? rollups?.text.foldView : null, indexRead: textIndexRead.toString(),
      indexSql: textIndexSql(members, section), firstDay: ROLLUP_FIRST_DAY, lastDay: ROLLUP_LAST_DAY,
      dayMs: MS_PER_DAY, halves: HALVES, weekDays: WEEK_DAYS, maxDayBuckets: DAY_BUCKETS_MAX_DAYS,
      top: STATS_TOP, stopWords: en, minWordLength: MIN_WORD_LENGTH, cloudWords: CLOUD_WORDS,
      lengthBuckets: MESSAGE_WORD_BUCKETS, personMinMessages: WORDS_PERSON_MIN_MESSAGES,
      trendMinUses: WORD_TREND_MIN_USES, trendTop: WORD_TREND_TOP, rateScale: WORD_RATE_BASE },
  } }))[0]!;
  signal?.throwIfAborted();
  const current = () => Boolean(token && rollups!.text!.snapshot() === token);
  return cachedStats(read, token ? JSON.stringify([section, query, token]) : null, current, async () => {
    const value = await load(token ? TEXT_VIEW : undefined);
    if (token && !current()) throw new AnalyticsPending();
    return value;
  });
}
