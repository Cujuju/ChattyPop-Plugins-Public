// Settings → Summaries → Compare models: pick models, run them on one range, read their summaries side by side.
import { createSignal, For, Show } from 'solid-js';
import { Card, Note, Row, Select, countText, look, usdText, weekdayDateTime } from '@plugin-sdk/renderer/kit';
import { SUMMARY_RANGES, type SummaryRange } from '../shared/settings';
import type { Comparison } from '../shared/compare';
import { summarySettings } from './settings';
import {
  compareError,
  compareProgress,
  compareRunning,
  createComparisonList,
  createOpenComparison,
  modelText,
  openComparisonId,
  rangeText,
  removeComparison,
  runComparison,
  setOpenComparisonId,
  totalsText,
} from './compareState';
import { exportComparison } from './compareExport';
import { ModelsCard } from './CompareModels';
import { spansDays } from './order';
import { META, SummaryContent } from './SummaryContent';
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
        label="Compare"
        hint="Models run at once; each uses its provider's plan or credits."
        control={
          <button
            type="button"
            class="cp-primary"
            disabled={compareRunning() || !summarySettings().compareModels.length}
            onClick={() => void runComparison(range())}
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
              label={rangeText(h.sinceTs, h.untilTs)}
              hint={
                <span class={styles.pastHint}>
                  <span class={styles.chips}>
                    <For each={h.models}>
                      {(m) => (
                        <span class={`${styles.chip} ${look.tag} ${look.text}`} data-size="2xs" data-line="chip" data-font="sans">
                          {modelText(m)}
                        </span>
                      )}
                    </For>
                  </span>
                  <span>
                    {[
                      `Ran ${weekdayDateTime(h.createdAt)}`,
                      countText(h.messageCount, 'message'),
                      ...(h.apiCostUsd !== null ? [`≈${usdText(h.apiCostUsd)}`] : []),
                      ...(h.failed ? [`${h.failed} failed`] : []),
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
  const head = () =>
    [
      rangeText(c().sinceTs, c().untilTs),
      `${countText(c().messageCount, 'message')}${c().skippedCount ? ` (${c().skippedCount} skipped)` : ''}`,
      totalsText(c()),
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <section class={styles.compare} aria-label="Comparison">
      <div class={styles.compareHead}>
        <p class={`${styles.meta} ${look.text}`} {...META}>
          {head()}
        </p>
        <button type="button" class="cp-button" onClick={() => exportComparison(c())}>
          Export HTML
        </button>
      </div>
      <div class={styles.columns}>
        <For each={c().results}>
          {(r) => (
            <article class={`${styles.column} ${look.card}`} aria-label={modelText(r.model)}>
              <p class={look.text} data-size="sm" data-weight="semibold" data-font="sans" data-tone="primary">
                {modelText(r.model)}
              </p>
              <Show
                when={r.summary}
                fallback={
                  <p class={`${styles.error} ${look.text}`} data-size="md" data-tone="danger" role="alert">
                    {r.error}
                  </p>
                }
              >
                {(s) => <SummaryContent summary={s()} withDay={spansDays(s())} />}
              </Show>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}
