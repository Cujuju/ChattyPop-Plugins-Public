// Settings → Summaries → Compare models: pick models, run them on one range, read their summaries side by side.
import { createSignal, For, Show } from 'solid-js';
import { Card, Note, Row, Select, countText, errorText, look, usdText, weekdayDateTime } from '@plugin-sdk/renderer/kit';
import { SUMMARY_RANGES, type SummaryRange } from '../shared/settings';
import type { Comparison } from '../shared/compare';
import type { SummaryScope } from '../shared/types';
import { ScopeSelect, scopeLabel } from './scope';
import { summarySettings } from './settings';
import {
  compareError,
  compareProgress,
  columnUsageText,
  compareRunning,
  createComparisonList,
  createOpenComparison,
  modelText,
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

const RANGE_OPTIONS = Object.entries(SUMMARY_RANGES).map(([id, r]) => ({ value: id, label: r.label }));

export function CompareBody() {
  return (
    <>
      <Note>
        Summarize one range with several models and read the results side by side. Every model gets the same messages
        and prompts. Comparisons stay out of the Summary panel; their cost counts in Spending.
      </Note>
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
        hint="Everything, one server, or one channel."
        control={<ScopeSelect id="compare-scope" class={styles.control} value={scope()} onChange={setScope} />}
      />
      <Row
        label="Compare"
        hint="Models run at once; each uses its provider's plan or credits."
        control={
          <button
            type="button"
            class="cp-primary"
            disabled={compareRunning() || !summarySettings().compareModels.length}
            onClick={() => void runComparison(range(), scope())}
          >
            {compareRunning() ? 'Running…' : 'Run'}
          </button>
        }
      />
      <Show when={progressText()}>
        <Note kind="status">{progressText()}</Note>
      </Show>
      <Show when={compareError()}>
        <Note kind="error">{compareError()}</Note>
      </Show>
    </Card>
  );
}

/** Stored comparisons, each opened or deleted on its own; the open one below. */
function PastCard() {
  const list = createComparisonList();
  const open = createOpenComparison();
  const remove = (id: number): void => {
    if (window.confirm('Delete this comparison?')) void removeComparison(id);
  };
  return (
    <>
      <Card title="Past comparisons" meta={countText(list().length, 'comparison')}>
        <For each={list()} fallback={<Note>None yet.</Note>}>
          {(h) => (
            <Row
              label={`${scopeLabel(h.scope)} · ${rangeText(h.sinceTs, h.untilTs)}`}
              hint={
                <span class={styles.pastHint}>
                  <For each={h.columns}>
                    {(col) => (
                      <span class={styles.columnLine}>
                        <span class={`${styles.chip} ${look.tag} ${look.text}`} data-size="2xs" data-line="chip" data-font="sans">
                          {modelText(col.model)}
                        </span>
                        <span class={look.text} data-tone={col.failed ? 'danger' : undefined}>
                          {columnUsageText(col)}
                        </span>
                      </span>
                    )}
                  </For>
                  <span>
                    {[
                      `Ran ${weekdayDateTime(h.createdAt)}`,
                      countText(h.messageCount, 'message'),
                      ...(h.apiCostUsd !== null ? [`≈${usdText(h.apiCostUsd)} in all`] : []),
                    ].join(' · ')}
                  </span>
                </span>
              }
              control={
                <span class={styles.buttons}>
                  <button
                    type="button"
                    class="cp-button"
                    aria-pressed={openComparisonId() === h.id}
                    onClick={() => setOpenComparisonId(openComparisonId() === h.id ? null : h.id)}
                  >
                    {openComparisonId() === h.id ? 'Close' : 'Open'}
                  </button>
                  <button type="button" class="cp-danger" onClick={() => remove(h.id)}>
                    Delete
                  </button>
                </span>
              }
            />
          )}
        </For>
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
      <div class={styles.compareHead}>
        <ComparisonMeta comparison={c()} />
        <span class={styles.buttons}>
          <button type="button" class="cp-button" onClick={() => void exportComparison(c())}>
            Export HTML
          </button>
          <button type="button" class="cp-button" disabled={pdfBusy()} onClick={exportPdf}>
            {pdfBusy() ? 'Exporting…' : 'Export PDF'}
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
