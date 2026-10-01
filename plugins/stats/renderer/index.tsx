// The Activity plugin's renderer side: its panel.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { STATS_PANEL, plugin } from '../shared';
import { StatsPanel } from './StatsPanel';

export default defineRendererPlugin(plugin, { panels: { [STATS_PANEL]: { view: StatsPanel } } });
