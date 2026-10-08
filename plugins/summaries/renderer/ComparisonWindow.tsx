// The Comparison panel: the comparison opened in Settings → Summaries → Compare models, a column per model.
import { createSignal, Show } from 'solid-js';
import { errorText, isPanelCollapsed, Note, PanelHeader } from '@plugin-sdk/renderer/kit';
import { COMPARISON_PANEL } from '../shared';
import type { Comparison } from '../shared/compare';
import { createOpenComparison } from './compareState';
import { exportComparison, exportComparisonPdf } from './compareExport';
import { ComparisonColumns, ComparisonMeta } from './ComparisonParts';
import styles from './Summary.module.css';
import compare from './Compare.module.css';

export function ComparisonPanel() {
  const open = createOpenComparison();
  return (
    <section class="cp-panel" aria-label="Comparison" data-section={COMPARISON_PANEL}>
      <PanelHeader section={COMPARISON_PANEL} collapsible title="Comparison" />
      <Show when={!isPanelCollapsed(COMPARISON_PANEL)}>
        <Show when={open()} fallback={<p class="cp-panel-empty">Open a comparison in Settings → Summaries → Compare models.</p>}>
          {(c) => (
            <div class="cp-panel-body">
              <ComparisonView comparison={c()} />
            </div>
          )}
        </Show>
      </Show>
    </section>
  );
}

/** One comparison: what every model read and used in total, its exports, then a column per model in list order. */
export function ComparisonView(props: { comparison: Comparison }) {
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
    <div class={styles.compare}>
      <div class={compare.head}>
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
    </div>
  );
}
