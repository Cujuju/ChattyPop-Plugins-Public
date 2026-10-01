// The plans table, adopted from the host (where it was created before Plans was a plugin): the descriptor's adopts. And
// Jev's hits still to extract, kept across quits.
import { pluginTable } from '@plugin-sdk/shared';
import { plugin } from '../shared';

export const PLANS_TABLE = pluginTable(plugin, 'items');
/** Hits whose extraction hasn't ended: message id, 'plan' or 'decision', and when Jev found it (their order). */
export const PENDING_TABLE = pluginTable(plugin, 'pending');

/** Plans' own schema steps (ctx.storage.migrate); append, never edit a shipped one. */
export const PLANS_MIGRATIONS: readonly string[] = [
  `CREATE TABLE ${PENDING_TABLE} (message_id TEXT PRIMARY KEY, kind TEXT NOT NULL, queued_at INTEGER NOT NULL)`,
];
