// A comparison's own window, opened from Settings → Summaries → Compare models: one per comparison, several at once.
import { createSignal, Show } from 'solid-js';
import { errorText, look, Note } from '@plugin-sdk/renderer/kit';
import type { Comparison } from '../shared/compare';
import { createComparison, createComparisonList, rangeText } from './compareState';
import { exportComparison, exportComparisonPdf } from './compareExport';
import { ComparisonColumns, ComparisonMeta } from './ComparisonParts';
import { scopeLabel } from './scope';
import styles from './Summary.module.css';

/** The window's title: what the comparison read, so open windows tell apart. */
export function ComparisonWindowTitle(props: { key: string }) {
  const list = createComparisonList();
  const head = () => list().find((h) => String(h.id) === props.key);
  return <>{head() ? `${scopeLabel(head()!.scope)} · ${rangeText(head()!.sinceTs, head()!.untilTs)}` : 'Comparison'}</>;
}

/** Comparison `key` filling its window: its bar stays put while the columns scroll both ways. */
export function ComparisonWindow(props: { key: string }) {
  const c = createComparison(() => Number(props.key));
  return (
    <div class={styles.compareWindow} data-section="summary">
      <Show when={c()} fallback={<Show when={!c.loading}><p class="cp-panel-empty">This comparison is gone.</p></Show>}>
        {(shown) => <ComparisonView comparison={shown()} />}
      </Show>
    </div>
  );
}

/** One comparison: what every model read and used in total with its exports at the right, then a column per model in list order. */
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
      <div class={`${styles.compareBar} ${look.band}`}>
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
      <div class={styles.compareScroll}>
        <ComparisonColumns comparison={c()} />
      </div>
    </div>
  );
}
