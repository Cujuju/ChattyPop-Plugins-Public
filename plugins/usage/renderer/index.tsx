// Plan usage's renderer side: its panel (also a companion drawer pane) and providers' display names in Settings → AI.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { USAGE_PANEL, plugin } from '../shared';
import { DisplayNameRow } from './DisplayNameRow';
import { UsagePanel } from './UsagePanel';

export default defineRendererPlugin(plugin, {
  panels: { [USAGE_PANEL]: { view: UsagePanel } },
  phoneDrawer: { plan: { label: 'plan usage', section: USAGE_PANEL, Component: UsagePanel } },
  providerRows: { 'display-name': { Component: DisplayNameRow } },
});
