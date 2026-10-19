import { rollupView } from '@plugin-sdk/core';
import { plugin } from '../shared';
import type { StatsSqlScope } from './query';
import { TEXT_ROLLUP_VERSION } from './rollups';

export const TEXT_INDEX = rollupView(plugin, 'text', TEXT_ROLLUP_VERSION, 'folded');

/** Table names are resolved on Core; workers receive SQL and named query parameters. */
export function textIndexSql(scope: StatsSqlScope, section: string) {
  const params: Record<string, string | number> = {};
  let i = 0;
  const where = scope.sql.replaceAll('?', () => { const key = `scope${i}`; params[key] = scope.params[i++]!; return '@' + key; });
  const bounds = 'm.day >= @first AND m.day < @last AND m.day NOT IN (SELECT value FROM json_each(@excluded))';
  const kinds = section === 'words' ? "m.kind IN ('extent', 'lengths')"
    : section === 'emoji' ? "m.kind IN ('extent', 'lengths', 'emoji')" : "m.kind IN ('extent', 'lengths')";
  return {
    params,
    summary: `SELECT m.* FROM ${TEXT_INDEX} m WHERE ${where} AND m.author_id = '' AND ${kinds} AND ${bounds}`,
    longest: `SELECT m.* FROM ${TEXT_INDEX} m WHERE ${where} AND m.author_id = '' AND m.kind = 'longest'
      AND m.day >= @firstMonth AND m.day <= @lastMonth AND m.day NOT IN (SELECT value FROM json_each(@edges))`,
    candidates: `SELECT m.* FROM json_each(@edges) e CROSS JOIN ${TEXT_INDEX} m
      ON m.day >= e.value || '-01' AND m.day < date(e.value || '-01', '+1 month')
      WHERE ${where} AND m.kind = 'candidate' AND ${bounds}`,
    series: `SELECT m.term, m.payload FROM ${TEXT_INDEX} m WHERE ${where} AND m.kind = 'term' AND m.author_id = ''
      AND m.term IN (SELECT value FROM json_each(@choices))`,
    identities: `SELECT m.* FROM ${TEXT_INDEX} m WHERE ${where} AND m.kind = 'identity'`,
    personMonths: `SELECT m.* FROM ${TEXT_INDEX} m WHERE ${where} AND m.kind = 'personMonth' AND m.day >= @firstMonth AND m.day <= @lastMonth
      AND m.day NOT IN (SELECT value FROM json_each(@edges))`,
    personDays: `SELECT m.* FROM json_each(@edges) e CROSS JOIN ${TEXT_INDEX} m
      ON m.day >= e.value || '-01' AND m.day < date(e.value || '-01', '+1 month')
      WHERE ${where} AND m.kind = 'person' AND ${bounds}`,
    counts: `SELECT m.channel_id, m.payload FROM ${TEXT_INDEX} m WHERE ${where} AND m.author_id = '' AND m.kind = 'dictionary'`,
    prefixes: `SELECT m.channel_id, m.day, m.payload FROM ${TEXT_INDEX} m WHERE ${where} AND m.author_id = '' AND m.kind = 'prefixPack'
      AND m.day IN (SELECT value FROM json_each(@months))`,
  };
}
