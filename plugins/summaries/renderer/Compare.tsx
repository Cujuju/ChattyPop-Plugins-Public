// Settings → Summaries → Compare models: pick models, run them on one range, read their summaries side by side.
import { createSignal, For, Show } from 'solid-js';
import { Card, Icon, Note, Row, Select, confirmDialog, countText, inCompanion, look, usdText } from '@plugin-sdk/renderer/kit';
import { SUMMARY_RANGES, type SummaryRange } from '../shared/settings';
import type { SummaryScope } from '../shared/types';
import { ScopeSelect, scopeLabel } from './scope';
import { summarySettings } from './settings';
import {
  compareError,
  compareProgress,
  compareRunning,
  cancelComparison,
  createComparisonList,
  createOpenComparison,
  deleteError,
  openComparison,
  openComparisonId,
  rangeText,
  removeComparison,
  runComparison,
  setOpenComparisonId,
} from './compareState';
import { ComparisonView } from './ComparisonPanel';
import { ModelsCard } from './CompareModels';
import styles from './Summary.module.css';
import compare from './Compare.module.css';

const RANGE_OPTIONS = Object.entries(SUMMARY_RANGES).map(([id, r]) => ({ value: id, label: r.label }));

export function CompareBody() {
  return (
    <>
      <Note>Run one range through several models and read their summaries side by side. Every model gets the same input; the cost counts in Spending.</Note>
      <ModelsCard />
      <RunCard />
      <PastCard />
    </>
  );
}

function RunCard() {
  const [picked, setPicked] = createSignal<SummaryRange | null>(null);
  const [scope, setScope] = createSignal<SummaryScope | null>(null);
  const range = () => picked() ?? summarySettings().defaultRange;
  const models = () => summarySettings().compareModels.length;
  const progressText = (): string => {
    if (!compareRunning()) return '';
    const p = compareProgress();
    return p?.phase === 'writing' ? `${p.done} of ${countText(p.total, 'model')} done` : 'Preparing messages…';
  };
  return (
    <Card title="Run">
      <Row
        label="Range"
        for="compare-range"
        control={<Select id="compare-range" class={styles.control} value={range()} options={RANGE_OPTIONS} onChange={(v) => setPicked(v as SummaryRange)} />}
      />
      <Row
        label="Channels"
        for="compare-scope"
        control={<ScopeSelect id="compare-scope" class={styles.control} value={scope()} onChange={setScope} />}
      />
      <Row
        label={
          <span class={look.text} data-size="xs" data-tone="muted" role="status">
            {progressText()}
          </span>
        }
        control={
          <Show
            when={compareRunning()}
            fallback={
              <button type="button" class="cp-primary" disabled={!models()} onClick={() => void runComparison(range(), scope())}>
                {models() > 1 ? `Run ${models()} models` : 'Run'}
              </button>
            }
          >
            <button type="button" class="cp-button" onClick={() => void cancelComparison()}>
              Cancel
            </button>
          </Show>
        }
      />
      <Show when={compareError()}>
        <Note kind="error">{compareError()}</Note>
      </Show>
    </Card>
  );
}

/** Stored comparisons, newest first. Open shows one in the Comparison panel; the phone has no panels, so it shows below the list. */
function PastCard() {
  const list = createComparisonList();
  const isOpen = (id: number): boolean => openComparisonId() === id;
  const remove = (id: number): void => {
    void confirmDialog({ title: 'Delete comparison', message: 'Delete this comparison?', confirmLabel: 'Delete', danger: true }).then((ok) => (ok ? removeComparison(id) : undefined));
  };
  return (
    <>
      <Card title="Past comparisons" meta={countText(list().length, 'comparison')}>
        <For each={list()} fallback={<Note>None yet.</Note>}>
          {(h) => (
            <Row
              label={`${scopeLabel(h.scope)} · ${rangeText(h.sinceTs, h.untilTs)}`}
              hint={
                <>
                  {[
                    countText(h.columns.length, 'model'),
                    countText(h.messageCount, 'message'),
                    ...(h.apiCostUsd !== null ? [`≈${usdText(h.apiCostUsd)}`] : []),
                  ].join(' · ')}
                  <Show when={h.columns.filter((col) => col.failed).length}>
                    {(failed) => (
                      <span class={look.text} data-tone="danger">
                        {` · ${failed()} failed`}
                      </span>
                    )}
                  </Show>
                </>
              }
              control={
                <>
                  <button type="button" class="cp-button" aria-expanded={isOpen(h.id)} onClick={() => (isOpen(h.id) ? setOpenComparisonId(null) : openComparison(h.id))}>
                    {isOpen(h.id) ? 'Close' : 'Open'}
                  </button>
                  <button type="button" class={`cp-danger ${compare.iconButton}`} aria-label="Delete comparison" title="Delete comparison" onClick={() => remove(h.id)}>
                    <Icon name="trash" />
                  </button>
                </>
              }
            />
          )}
        </For>
        <Show when={deleteError()}>
          <Note kind="error">{deleteError()}</Note>
        </Show>
      </Card>
      <Show when={inCompanion}>
        <OpenComparison />
      </Show>
    </>
  );
}

/** The phone's open comparison, under the list. */
function OpenComparison() {
  const open = createOpenComparison();
  return <Show when={open()}>{(c) => <ComparisonView comparison={c()} />}</Show>;
}
