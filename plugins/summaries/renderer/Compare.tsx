// Settings → Summaries → Compare models: pick models, run them on one range, read their summaries side by side.
import { createSignal, For, Show } from 'solid-js';
import { Card, Note, Row, Select, countText, errorText, look, usdText } from '@plugin-sdk/renderer/kit';
import { SUMMARY_RANGES, type SummaryRange } from '../shared/settings';
import type { Comparison } from '../shared/compare';
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
  openComparisonId,
  rangeText,
  removeComparison,
  runComparison,
  setOpenComparisonId,
} from './compareState';
import { exportComparison, exportComparisonPdf } from './compareExport';
import { ComparisonColumns, ComparisonMeta } from './ComparisonParts';
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

/** Stored comparisons, newest first; the open one below the list. */
function PastCard() {
  const list = createComparisonList();
  const open = createOpenComparison();
  const isOpen = (id: number): boolean => openComparisonId() === id;
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
                <button type="button" class="cp-button" aria-expanded={isOpen(h.id)} onClick={() => setOpenComparisonId(isOpen(h.id) ? null : h.id)}>
                  {isOpen(h.id) ? 'Close' : 'Open'}
                </button>
              }
            />
          )}
        </For>
        <Show when={deleteError()}>
          <Note kind="error">{deleteError()}</Note>
        </Show>
      </Card>
      <Show when={open()}>{(c) => <ComparisonView comparison={c()} />}</Show>
    </>
  );
}

/** One comparison: what every model read and used in total, then a column per model in list order. */
function ComparisonView(props: { comparison: Comparison }) {
  const c = () => props.comparison;
  const [pdfBusy, setPdfBusy] = createSignal(false);
  const [pdfError, setPdfError] = createSignal<string | null>(null);
  const remove = (): void => {
    if (window.confirm('Delete this comparison?')) void removeComparison(c().id);
  };
  // Called straight from the tap: on the phone, the browser opens its window only within it.
  const exportPdf = (): void => {
    setPdfError(null);
    setPdfBusy(true);
    exportComparisonPdf(c())
      .catch((err: unknown) => setPdfError(errorText(err)))
      .finally(() => setPdfBusy(false));
  };
  return (
    <section class={styles.compare} aria-label="Comparison">
      <div class={compare.head}>
        <ComparisonMeta comparison={c()} />
        <span class={styles.buttons}>
          <button type="button" class="cp-button" onClick={() => void exportComparison(c())}>
            Export HTML
          </button>
          <button type="button" class="cp-button" disabled={pdfBusy()} onClick={exportPdf}>
            {pdfBusy() ? 'Exporting…' : 'Export PDF'}
          </button>
          <button type="button" class={`cp-danger ${compare.deleteButton}`} onClick={remove}>
            Delete
          </button>
        </span>
      </div>
      <Show when={pdfError()}>
        <Note kind="error">{pdfError()}</Note>
      </Show>
      <ComparisonColumns comparison={c()} />
    </section>
  );
}
