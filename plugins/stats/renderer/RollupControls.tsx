import { callable, desktopCoreClient, panelShown, pluginResource } from '@plugin-sdk/renderer';
import { RollupControls as Controls } from '@plugin-sdk/renderer/kit';
import type { RollupStatus } from '@plugin-sdk/shared';
import { plugin } from '../shared';

const EMPTY: RollupStatus = { building: false, dirty: 0, total: 0, error: null };

export function RollupControls(props: { onRebuilt?: () => unknown }) {
  const status = pluginResource(plugin, 'rollupStatus', () => [], EMPTY, { shown: panelShown('stats') });
  return <Controls pluginId={plugin.manifest.id} status={status} label="analytics" title="Rebuild analytics"
    canRebuild={callable(plugin, 'rebuildRollups')} rebuild={() => desktopCoreClient(plugin).rebuildRollups()} onRebuilt={props.onRebuilt} />;
}
