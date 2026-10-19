import { rollupView, type CoreContext, type Rollup } from '@plugin-sdk/core';
import { pluginTable, MS_PER_DAY } from '@plugin-sdk/shared';
import { plugin } from '../shared';
import { ATTACHMENT_KINDS, EDIT_DELAY_BUCKETS } from '../shared/types';
import { countWork, type CountData } from './countWork';
import { textWork } from './textWork';
import { runWork, RUN_PAGE_SIZE } from './runWork';
import { CONVERSATION_GAP_MS } from '../shared/conversations';
import { afinn165 } from 'afinn-165';
import { STATS_TOP } from '../shared/types';
import { textIndex } from './textIndex';
import { countIndex } from './countIndex';

export const ROLLUP_VERSION = 1; // Counts and lexical summaries start at the first maintained schema.
export const TEXT_ROLLUP_VERSION = 2; // Query indexes accompany the packed daily lexical grain.
const TEXT_SOURCE = pluginTable(plugin, 'rollup_text_v2');
export const COUNT_ROLLUP_VERSION = 2; // Packed identity histories and shared calendar histograms.
export const COUNT_VIEW = rollupView(plugin, 'counts', COUNT_ROLLUP_VERSION);
const COUNT_SOURCE = pluginTable(plugin, 'rollup_counts_v2');
export const COUNT_DATA: CountData = { dayMs: MS_PER_DAY, editLimits: EDIT_DELAY_BUCKETS.map((b) => b.beforeMs), kinds: ATTACHMENT_KINDS };
export interface StatsRollups { counts: Rollup; links: Rollup; text: Rollup; runs: Rollup }
export function defineStatsRollups(ctx: CoreContext): StatsRollups {
  const counts = ctx.rollups.define('counts', {
    version: COUNT_ROLLUP_VERSION, key: ['author_id', 'date', 'kind', 'url'],
    columns: { author_id: 'TEXT', date: 'TEXT', kind: 'TEXT', url: 'TEXT', n: 'INTEGER', text_n: 'INTEGER', edited_n: 'INTEGER',
      attachment_n: 'INTEGER', linked_n: 'INTEGER', first_ts: 'INTEGER', last_ts: 'INTEGER', first_id: 'TEXT', name: 'TEXT', payload: 'TEXT' },
    dependsOn: ['messages', 'edits', 'deletes', 'attachments', 'links', 'names'], timeZoneSensitive: true,
    fold: { columns: { author_id: 'TEXT', kind: 'TEXT', payload: 'TEXT' }, key: ['kind', 'author_id'],
      data: { sql: `SELECT * FROM ${COUNT_SOURCE} WHERE channel_id = ?` }, compute: countIndex },
    data: { ...COUNT_DATA, outputKind: 'message' }, compute: countWork,
  });
  const links = ctx.rollups.define('shares', {
    version: ROLLUP_VERSION, key: ['author_id', 'url'],
    columns: { author_id: 'TEXT', date: 'TEXT', kind: 'TEXT', url: 'TEXT', n: 'INTEGER', text_n: 'INTEGER', edited_n: 'INTEGER',
      attachment_n: 'INTEGER', linked_n: 'INTEGER', first_ts: 'INTEGER', last_ts: 'INTEGER', first_id: 'TEXT', name: 'TEXT', payload: 'TEXT' },
    allTime: { values: { date: 'min', kind: 'min', n: 'sum', text_n: 'sum', edited_n: 'sum', attachment_n: 'sum', linked_n: 'sum',
      first_ts: 'min', last_ts: 'max', first_id: 'earliest', name: 'min', payload: 'earliest' }, orderBy: 'first_ts' },
    dependsOn: ['messages', 'edits', 'deletes', 'links', 'names'], timeZoneSensitive: true,
    data: { ...COUNT_DATA, outputKind: 'link' }, compute: countWork,
  });
  const text = ctx.rollups.define('text', {
    version: TEXT_ROLLUP_VERSION, key: ['author_id', 'date', 'kind', 'term'],
    columns: { author_id: 'TEXT', date: 'TEXT', kind: 'TEXT', term: 'TEXT', n: 'INTEGER', first_ts: 'INTEGER', last_ts: 'INTEGER', seq: 'INTEGER', position: 'INTEGER', payload: 'TEXT' },
    indexes: [['kind', 'author_id', 'term']],
    fold: {
      columns: { day: 'TEXT', author_id: 'TEXT', date: 'TEXT', kind: 'TEXT', term: 'TEXT', n: 'INTEGER', first_ts: 'INTEGER', last_ts: 'INTEGER',
        seq: 'INTEGER', position: 'INTEGER', before_n: 'INTEGER', payload: 'TEXT' },
      key: ['kind', 'author_id', 'term', 'day', 'date'],
      indexes: [['kind', 'author_id', 'day', 'date'], ['kind', 'author_id', 'term', 'n', 'seq', 'position', 'date']],
      data: { top: STATS_TOP, sql: `SELECT * FROM ${TEXT_SOURCE} WHERE channel_id = ? ORDER BY day` }, compute: textIndex,
    },
    dependsOn: ['messages', 'edits', 'deletes', 'names'], timeZoneSensitive: true,
    data: { afinn: afinn165, top: STATS_TOP }, compute: textWork,
  });
  const runs = ctx.rollups.define('runs', {
    version: ROLLUP_VERSION, key: ['opener_id'],
    columns: { opener_id: 'TEXT', first_ts: 'INTEGER', last_ts: 'INTEGER', payload: 'TEXT' },
    span: { start: 'first_ts', end: 'last_ts', paddingMs: CONVERSATION_GAP_MS },
    dependsOn: ['messages', 'edits', 'deletes', 'channels', 'names'],
    data: { gapMs: CONVERSATION_GAP_MS, pageSize: RUN_PAGE_SIZE }, compute: runWork,
  });
  return { counts, links, text, runs };
}
