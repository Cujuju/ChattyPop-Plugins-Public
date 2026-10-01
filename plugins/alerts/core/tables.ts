// Alerts storage adopted from the host, retaining row ids and references.
import { pluginTable, visibleTable } from '@plugin-sdk/shared';
import { plugin } from '../shared';

/** The inbox table. */
export const ALERTS = pluginTable(plugin, 'alerts');

/** Host-filtered rows for display reads. */
export const VISIBLE_ALERTS = visibleTable(plugin, 'alerts');
