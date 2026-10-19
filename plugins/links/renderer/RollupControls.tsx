import { Show, createSignal } from 'solid-js';
import { callable, desktopCoreClient, onAppEvent, onCleanup, panelShown, pluginResource } from '@plugin-sdk/renderer';
import { HeaderButton, HeaderMeta } from '@plugin-sdk/renderer/kit';
import type { RollupStatus } from '@plugin-sdk/shared';
import { plugin } from '../shared';

const EMPTY: RollupStatus = { building: false, dirty: 0, total: 0, error: null };

export function RollupControls(props: { onRebuilt?: () => unknown }) {
  const status = pluginResource(plugin, 'rollupStatus', () => [], EMPTY, { shown: panelShown('links') });
  const [error, setError] = createSignal<string | null>(null);
  let requested = false;
  onCleanup(onAppEvent('rollup-progress', (event) => {
    if (event.pluginId !== plugin.manifest.id) return;
    void status.refetch().then(async () => {
      if (requested && !event.building && !status().building && !status.loading && !status.failure) {
        requested = false;
        await props.onRebuilt?.();
      }
    }).catch((error) => setError(String(error)));
  }));
  const rebuild = async () => {
    setError(null);
    requested = true;
    try { await desktopCoreClient(plugin).rebuildRollups(); await status.refetch(); }
    catch (error) { requested = false; setError(String(error)); }
  };
  return <>
    <Show when={status().building}><HeaderMeta>Updating counts…</HeaderMeta></Show>
    <Show when={status().error || error()}><HeaderMeta title={status().error ?? error() ?? undefined}>Counts need attention</HeaderMeta></Show>
    <Show when={callable(plugin, 'rebuildRollups')}>
      <HeaderButton title="Rebuild link counts" disabled={status().building && !status().error} onClick={() => void rebuild()}>Rebuild counts</HeaderButton>
    </Show>
  </>;
}
