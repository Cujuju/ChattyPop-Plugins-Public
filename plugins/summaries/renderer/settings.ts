// Adopted summary preferences shared by every plugin view.
import { pluginPreference } from '@plugin-sdk/renderer';
import { plugin } from '../shared';

/** Settings and field updates under the adopted plugin key. */
export const [summarySettings, setSummarySettings, { patch: patchSummarySettings }] = pluginPreference(plugin, 'settings');
