// Model comparisons: the stored list, the one open, and a run's progress.
import { createMemo, createSignal } from 'solid-js';
import { callable, coreClient, onAppEvent, onEvent, pluginResource, pluginsLoaded } from '@plugin-sdk/renderer';
import { clockTime, createAction, effortLabel, formatTokens, providerName, providerStatus, usdText, weekdayDateTime } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import type { ColumnHead, CompareModel, CompareProgress, Comparison } from '../shared/compare';
import type { SummaryRange } from '../shared/settings';
import type { SummaryScope } from '../shared/types';
import { summarySettings } from './settings';
import { rangeOf } from './state';
import { spansDays } from './order';

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

/** Runs the saved models over `range` in `scope` and opens the result. */
export async function runComparison(range: SummaryRange, scope: SummaryScope | null): Promise<void> {
  setCompareProgress(null);
  const c = await action.run(async () => core.compare({ ...(await rangeOf(range, scope)), ...(scope ? { scope } : {}), models: summarySettings().compareModels }));
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

/** A range with its day once when it starts and ends the same day: "Wed, Oct 7, 01:22 PM – 01:52 PM". */
export const rangeText = (sinceTs: number, untilTs: number): string =>
  spansDays({ sinceTs, untilTs }) ? `${weekdayDateTime(sinceTs)} – ${weekdayDateTime(untilTs)}` : `${weekdayDateTime(sinceTs)} – ${clockTime(untilTs)}`;

/** One model's tokens and API cost in the list of comparisons, saying which it didn't report; or that it failed. */
export function columnUsageText(col: ColumnHead): string {
  if (col.failed) return 'Failed';
  const u = col.usage;
  return [
    ...(u ? [`${formatTokens(u.inputTokens)} in`, `${formatTokens(u.outputTokens)} out`] : ['tokens not reported']),
    col.apiCostUsd !== null ? `≈${usdText(col.apiCostUsd)}` : 'API cost unknown',
  ].join(' · ');
}

/** Hex digits of an input fingerprint shown: enough to tell two apart at a glance. */
const FINGERPRINT_SHOWN = 8;

/** Whether model `r` was sent exactly the comparison's input; null when unknown (it sent nothing, or an older comparison). */
export const sameInput = (c: Comparison, r: Comparison['results'][number]): boolean | null =>
  c.inputDigest === null || r.inputDigest === null ? null : r.inputDigest === c.inputDigest;

/** The input check over every model: its fingerprint when all match, else which ones differed; null before fingerprints were kept. */
export function inputCheck(c: Comparison): { ok: boolean; text: string } | null {
  if (c.inputDigest === null) return null;
  const differed = c.results.filter((r) => sameInput(c, r) === false).map((r) => modelText(r.model));
  return differed.length
    ? { ok: false, text: `Input differed for ${differed.join(', ')}` }
    : { ok: true, text: `Every model got the same input (fingerprint ${c.inputDigest.slice(0, FINGERPRINT_SHOWN)})` };
}

/** What every finished model used together: tokens, and API cost when each one reported it. */
export function totalsText(c: Comparison): string {
  const done = c.results.flatMap((r) => (r.summary ? [r.summary] : []));
  const used = done.flatMap((s) => (s.usage ? [s.usage] : []));
  const priced = done.flatMap((s) => (s.apiCostUsd !== null ? [s.apiCostUsd] : []));
  const unpriced = done.filter((s) => s.apiCostUsd === null && s.messageCount > 0).length;
  return [
    ...(used.length ? [`${formatTokens(used.reduce((n, u) => n + u.inputTokens, 0))} in`, `${formatTokens(used.reduce((n, u) => n + u.outputTokens, 0))} out`] : []),
    ...(priced.length ? [`≈${usdText(priced.reduce((n, x) => n + x, 0))} at API rates${unpriced ? ` (${unpriced} without a cost)` : ''}`] : []),
    ...(c.jevCostUsd !== null ? [`Jev's shared steps ${usdText(c.jevCostUsd)}`] : []),
  ].join(' · ');
}

/** A model as its column and the export name it: provider, model and thinking level. */
export function modelText(m: CompareModel): string {
  const listed = providerStatus().find((p) => p.id === m.provider)?.models?.find((x) => x.id === m.model);
  return [providerName(m.provider), listed?.label ?? m.model ?? 'default model', ...(m.effort ? [`${effortLabel(m.effort)} thinking`] : [])].join(' · ');
}
