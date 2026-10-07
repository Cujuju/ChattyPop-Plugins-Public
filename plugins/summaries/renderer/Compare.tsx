// Settings → Summaries → Compare models: pick models, run them on one range, read their summaries side by side.
import { createSignal, For, Show } from 'solid-js';
import type { ProviderId } from '@plugin-sdk/shared';
import {
  Card,
  EffortRow,
  ModelRow,
  Note,
  ProviderSelect,
  Row,
  Select,
  countText,
  look,
  providerSettingsOf,
  providerStatus,
  usdText,
  weekdayDateTime,
} from '@plugin-sdk/renderer/kit';
import { SUMMARY_RANGES, type SummaryRange } from '../shared/settings';
import type { Comparison } from '../shared/compare';
import { patchSummarySettings as update, summarySettings } from './settings';
import {
  compareError,
  compareProgress,
  compareRunning,
  createComparisonList,
  createOpenComparison,
  modelText,
  openComparisonId,
  removeComparison,
  runComparison,
  setOpenComparisonId,
} from './compareState';
import { exportComparison } from './compareExport';
import { spansDays } from './order';
import { META, SummaryContent } from './SummaryContent';
import styles from './Summary.module.css';

const RANGE_OPTIONS = Object.entries(SUMMARY_RANGES).map(([id, r]) => ({ value: id, label: r.label }));
const NO_CHOICE = { model: null, effort: null };

export function CompareBody() {
  return (
    <>
      <Note>
        Summarizes one range with each model below and shows their summaries side by side. The messages are read and
        prepared once (filler, quiet stretches and parts, with Jev's steps as you've set them), so every model gets
        exactly the same messages and prompts. Each summary then gets its own citation check and key themes.
        Comparisons stay here, out of the Summary panel; what they cost counts in Spending.
      </Note>
      <ModelsCard />
      <RunCard />
      <PastCard />
    </>
  );
}

/** The saved models, and a provider, model and thinking level to add. */
function ModelsCard() {
  const models = () => summarySettings().compareModels;
  const [picked, setPicked] = createSignal<ProviderId | null>(null);
  const provider = () => picked() ?? summarySettings().defaultProvider;
  const [choice, setChoice] = createSignal<{ model: string | null; effort: string | null }>(NO_CHOICE);
  // A model left on "from Settings → AI providers" is saved as the one that is now, so the comparison names it.
  const add = (p: ProviderId): void => {
    const { model, effort } = choice();
    const resolved = model ?? providerSettingsOf(p).model ?? providerStatus().find((s) => s.id === p)?.models?.find((m) => m.isDefault)?.id ?? null;
    update({ compareModels: [...models(), { provider: p, model: resolved, effort }] });
  };
  return (
    <Card title="Models" meta={countText(models().length, 'model')}>
      <For each={models()} fallback={<Note>None yet. Pick a provider, model and thinking level below, then add it.</Note>}>
        {(m, i) => (
          <Row
            label={`${i() + 1}. ${modelText(m)}`}
            control={
              <button type="button" class="cp-button" onClick={() => update({ compareModels: models().filter((_, j) => j !== i()) })}>
                Remove
              </button>
            }
          />
        )}
      </For>
      <Row
        label="Provider"
        for="compare-provider"
        control={
          <ProviderSelect
            id="compare-provider"
            value={provider()}
            onChange={(p) => {
              setPicked(p);
              setChoice(NO_CHOICE);
            }}
          />
        }
      />
      <Show when={provider()}>
        {(p) => (
          <>
            <ModelRow fieldId="compare-model" provider={p()} value={choice()} onChange={(patch) => setChoice({ ...choice(), ...patch })} />
            <EffortRow fieldId="compare-effort" provider={p()} value={choice()} onChange={(patch) => setChoice({ ...choice(), ...patch })} />
            <Row
              label="Add to the comparison"
              control={
                <button type="button" class="cp-button" onClick={() => add(p())}>
                  Add model
                </button>
              }
            />
          </>
        )}
      </Show>
    </Card>
  );
}

function RunCard() {
  const [picked, setPicked] = createSignal<SummaryRange | null>(null);
  const range = () => picked() ?? summarySettings().defaultRange;
  const progressText = (): string => {
    if (!compareRunning()) return '';
    const p = compareProgress();
    return p?.phase === 'writing' ? `${p.done} of ${countText(p.total, 'model')} done` : 'Reading and preparing the messages';
  };
  return (
    <Card title="Run">
      <Row
        label="Range"
        for="compare-range"
        control={<Select id="compare-range" class={styles.control} value={range()} options={RANGE_OPTIONS} onChange={(v) => setPicked(v as SummaryRange)} />}
      />
      <Row
        label="Run the comparison"
        hint="Every model runs at once. Each counts toward its provider's plan or credits."
        control={
          <button
            type="button"
            class="cp-primary"
            disabled={compareRunning() || !summarySettings().compareModels.length}
            onClick={() => void runComparison(range())}
          >
            {compareRunning() ? 'Running…' : 'Compare'}
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

/** Stored comparisons, each opened, exported or deleted on its own; the open one below. */
function PastCard() {
  const list = createComparisonList();
  const open = createOpenComparison();
  const remove = (id: number): void => {
    if (window.confirm('Delete this comparison? Its summaries are removed for good.')) void removeComparison(id);
  };
  return (
    <>
      <Card title="Past comparisons" meta={countText(list().length, 'comparison')}>
        <For each={list()} fallback={<Note>None yet.</Note>}>
          {(h) => (
            <Row
              label={`Ran ${weekdayDateTime(h.createdAt)}`}
              hint={`${weekdayDateTime(h.sinceTs)} → ${weekdayDateTime(h.untilTs)} · ${h.models.map(modelText).join(', ')}${h.failed ? ` · ${h.failed} failed` : ''}`}
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

/** One comparison: what every model read, then a column per model in the order they were listed. */
function ComparisonView(props: { comparison: Comparison }) {
  const c = () => props.comparison;
  const read = () =>
    `${weekdayDateTime(c().sinceTs)} → ${weekdayDateTime(c().untilTs)} · ${countText(c().messageCount, 'message')} every model read` +
    (c().skippedCount ? ` (${c().skippedCount} left out as filler or quiet)` : '') +
    (c().jevCostUsd !== null ? ` · Jev's shared steps ${usdText(c().jevCostUsd!)}` : '');
  return (
    <section class={styles.compare} aria-label="Comparison">
      <div class={styles.compareHead}>
        <p class={`${styles.meta} ${look.text}`} {...META}>
          {read()}
        </p>
        <button type="button" class="cp-button" onClick={() => exportComparison(c())}>
          Export .md
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
