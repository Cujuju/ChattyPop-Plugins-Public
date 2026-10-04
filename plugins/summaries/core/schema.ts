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
  // Retired, unread: the one-time passes that linked people in summaries stored before tags (#291, #303) marked their rows.
  `ALTER TABLE ${SUMMARIES_TABLE} ADD COLUMN people_linked INTEGER NOT NULL DEFAULT 0`,
] as const;
