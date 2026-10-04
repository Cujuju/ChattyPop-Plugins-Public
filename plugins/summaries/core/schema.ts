// Adopted summary storage retains every row and cache identity.
import { pluginTable, visibleTable } from '@plugin-sdk/shared';
import { plugin } from '../shared';

/** Summary rows adopted from the original host table. */
export const SUMMARIES_TABLE = pluginTable(plugin, 'summaries');

/** Host-filtered rows for display reads. */
export const VISIBLE_SUMMARIES = visibleTable(plugin, 'summaries');

/** Steps on the adopted table (its earlier columns came from host migrations); append only. */
export const SUMMARY_MIGRATIONS = [
  `ALTER TABLE ${SUMMARIES_TABLE} ADD COLUMN api_cost_usd REAL`,
  // 1 when api_cost_usd was estimated later from the stored tokens, not reported by the run's calls.
  `ALTER TABLE ${SUMMARIES_TABLE} ADD COLUMN api_cost_estimated INTEGER NOT NULL DEFAULT 0`,
  // The passes that linked its people as <@id> (PEOPLE_LINKED); a summary written with tags needs none.
  `ALTER TABLE ${SUMMARIES_TABLE} ADD COLUMN people_linked INTEGER NOT NULL DEFAULT 0`,
] as const;

/** people_linked: the last pass over a stored summary's names (linkStored.ts): none, whole names, then name leads. */
export const PEOPLE_LINKED = { none: 0, names: 1, leads: 2 } as const;
/** A summary written with person tags (#303) names everyone already: every pass counts as done. */
export const PEOPLE_LINKED_ALL = PEOPLE_LINKED.leads;
