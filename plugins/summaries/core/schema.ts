// Adopted summary storage retains every row and cache identity.
import { pluginTable, visibleTable } from '@plugin-sdk/shared';
import { plugin } from '../shared';

/** Summary rows adopted from the original host table. */
export const SUMMARIES_TABLE = pluginTable(plugin, 'summaries');

/** Host-filtered rows for display reads. */
export const VISIBLE_SUMMARIES = visibleTable(plugin, 'summaries');

/** Model comparisons (Settings → Summaries → Compare models); never in the Summary panel or its cache. */
export const COMPARISONS_TABLE = pluginTable(plugin, 'comparisons');

/** Host-filtered comparison rows for display reads. */
export const VISIBLE_COMPARISONS = visibleTable(plugin, 'comparisons');

/** Steps on the adopted table (its earlier columns came from host migrations); append only. */
export const SUMMARY_MIGRATIONS = [
  `ALTER TABLE ${SUMMARIES_TABLE} ADD COLUMN api_cost_usd REAL`,
  // 1 when api_cost_usd was estimated later from the stored tokens, not reported by the run's calls.
  `ALTER TABLE ${SUMMARIES_TABLE} ADD COLUMN api_cost_estimated INTEGER NOT NULL DEFAULT 0`,
  // Retired, unread: the one-time passes that linked people in summaries stored before tags (#291, #303) marked their rows.
  `ALTER TABLE ${SUMMARIES_TABLE} ADD COLUMN people_linked INTEGER NOT NULL DEFAULT 0`,
  // results_json: each model's StoredResult (compareRows.ts), in column order.
  `CREATE TABLE ${COMPARISONS_TABLE} (id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, since_ts INTEGER NOT NULL, until_ts INTEGER NOT NULL,
     channel_ids TEXT NOT NULL, message_count INTEGER NOT NULL, skipped_count INTEGER NOT NULL, grouping TEXT NOT NULL, jev_cost_usd REAL,
     results_json TEXT NOT NULL)`,
  // What a run was asked to read (SummaryScope JSON); null: everything.
  `ALTER TABLE ${SUMMARIES_TABLE} ADD COLUMN scope_json TEXT`,
  // SHA-256 of the part requests every model in a comparison was to be sent.
  `ALTER TABLE ${COMPARISONS_TABLE} ADD COLUMN input_digest TEXT`,
] as const;
