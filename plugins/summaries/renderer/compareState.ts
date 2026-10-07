// Model comparisons: the stored list, the one open, and a run's progress.
import { createMemo, createSignal } from 'solid-js';
import { callable, coreClient, onAppEvent, onEvent, pluginResource, pluginsLoaded } from '@plugin-sdk/renderer';
import { createAction, effortLabel, providerName, providerStatus } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import type { CompareModel, CompareProgress } from '../shared/compare';
import type { SummaryRange } from '../shared/settings';
import { summarySettings } from './settings';
import { rangeOf } from './state';

const core = coreClient(plugin);
const active = createMemo(() => pluginsLoaded() && callable(plugin, 'comparisons'));

/** Bumped when the stored comparisons change, so their reads run again. */
const [version, setVersion] = createSignal(0);
const changed = (): void => void setVersion((v) => v + 1);
onEvent(plugin, 'comparisonsChanged', changed);
// Privacy mode changed: listed and open comparisons may be filtered or redacted differently.
onAppEvent('privacy-changed', changed);

export const [openComparisonId, setOpenComparisonId] = createSignal<number | null>(null);
export const [compareProgress, setCompareProgress] = createSignal<CompareProgress | null>(null);
onEvent(plugin, 'compareProgress', (p) => { if (active()) setCompareProgress(p); });

const action = createAction();
export const compareRunning = action.busy;
export const compareError = action.error;

/** Runs the saved models over `range` and opens the result. */
export async function runComparison(range: SummaryRange): Promise<void> {
  setCompareProgress(null);
  const c = await action.run(async () => core.compare({ ...(await rangeOf(range)), models: summarySettings().compareModels }));
  setCompareProgress(null);
  if (c) setOpenComparisonId(c.id);
}

export async function removeComparison(id: number): Promise<void> {
  await action.run(() => core.deleteComparison(id));
  if (openComparisonId() === id) setOpenComparisonId(null);
}

/** Stored comparisons, newest first. Call inside a component. */
export const createComparisonList = () =>
  pluginResource(plugin, 'comparisons', () => {
    version();
    return [];
  }, []);

/** The open comparison; null while none is open or it is gone. Call inside a component. */
export const createOpenComparison = () =>
  pluginResource(plugin, 'comparison', () => {
    version();
    const id = openComparisonId();
    return id === null ? null : [id];
  }, null);

/** A model as its column and the export name it: provider, model and thinking level. */
export function modelText(m: CompareModel): string {
  const listed = providerStatus().find((p) => p.id === m.provider)?.models?.find((x) => x.id === m.model);
  return [providerName(m.provider), listed?.label ?? m.model ?? 'default model', ...(m.effort ? [`${effortLabel(m.effort)} thinking`] : [])].join(' · ');
}
