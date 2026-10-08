// Summary history, controls and cited results.
import { For, Show } from 'solid-js';
import type { Summary } from '../shared/types';
import type { SummaryTrigger } from '../shared/settings';
import {
  look,
  createFollowBottom,
  clockTime,
  shortDateTime,
  weekdayDateTime,
  isPanelCollapsed,
  PanelHeader,
  HeaderActions,
  scrolledFromTop,
} from '@plugin-sdk/renderer/kit';
import {
  loadOlderSummaries,
  overlapUntil,
  summaryError,
  summaryHistory,
  summaryProgress,
  summaryRunning,
} from './state';
import { scopeLabel } from './scope';
import { SummaryControls } from './SummaryControls';
import { spansDays } from './order';
import styles from './Summary.module.css';
import { META, SummaryContent } from './SummaryContent';

const PHASE_TEXT = {
  reading: 'Reading the archive',
  filtering: 'Jev: skipping filler',
  quiet: 'Jev: skipping quiet stretches',
  routing: 'Jev: picking the model',
  summarizing: 'Summarizing',
  merging: 'Merging parts',
  checking: 'Jev: checking citations',
  themes: 'Jev: sorting key themes',
  done: '',
  error: '',
} as const;


const TRIGGER_TEXT: Record<SummaryTrigger, string> = { manual: '', 'catch-up': 'Catch-up', digest: 'Daily digest', rule: 'Rule' };

/** F2 Summary: range and run; every run kept, oldest at the top and newest at the bottom, each headed by when it ran. */
export function SummaryPanel() {
  const log = createFollowBottom();
  let body!: HTMLDivElement;
  // Within a screen of the top, load older runs and keep what is on screen in place.
  const onScroll = async (): Promise<void> => {
    if (scrolledFromTop(body) > body.clientHeight) return;
    const before = body.scrollHeight;
    if (await loadOlderSummaries()) body.scrollTop += body.scrollHeight - before;
  };
  const progressText = (): string => {
    const p = summaryProgress();
    if (!summaryRunning()) return '';
    if (!p) return PHASE_TEXT.reading;
    return p.total > 0 ? `${PHASE_TEXT[p.phase]} ${p.done}/${p.total}` : PHASE_TEXT[p.phase];
  };
  return (
    <section class="cp-panel" aria-label="Summary">
      <PanelHeader section="summary" collapsible title="Summary">
        <HeaderActions>
          <SummaryControls />
        </HeaderActions>
      </PanelHeader>
      <Show when={!isPanelCollapsed('summary')}>
        <div
          class={`cp-panel-body ${styles.body}`}
          ref={(el) => {
            body = el;
            log.ref(el);
          }}
          onScroll={() => void onScroll()}
        >
          <Show when={summaryHistory.items.length === 0 && !summaryRunning()}>
            <p class={look.text} data-size="md" data-tone="muted">No summary yet. Open summary options, pick a time frame, and press Run summary.</p>
          </Show>
          <For each={summaryHistory.items}>{(s) => <SummaryRun summary={s} />}</For>
          {/* After the runs: the next run lands here. */}
          <Show when={progressText()}>
            <p class={look.text} data-size="xs" data-font="sans" data-tone="muted" role="status">
              {progressText()}
            </p>
          </Show>
          <Show when={summaryError()}>
            <p class={`${styles.error} ${look.text}`} data-size="md" data-tone="danger" role="alert">
              {summaryError()}
            </p>
          </Show>
        </div>
      </Show>
    </section>
  );
}

const isoTime = (ms: number): string => new Date(ms).toISOString();

/** One run, headed by the time it covers, then its body. */
function SummaryRun(props: { summary: Summary }) {
  const s = () => props.summary;
  const withDay = () => spansDays(s());
  return (
    <article class={styles.summary}>
      <p class={`${styles.meta} ${look.text}`} {...META} title={`Ran ${weekdayDateTime(s().createdAt)}`}>
        <time dateTime={isoTime(s().sinceTs)}>{weekdayDateTime(s().sinceTs)}</time>
        {' → '}
        <time dateTime={isoTime(s().untilTs)}>{withDay() ? weekdayDateTime(s().untilTs) : clockTime(s().untilTs)}</time>
        <Show when={TRIGGER_TEXT[s().trigger]}>{(t) => ` · ${t()}`}</Show>
        <Show when={s().scope}>{(sc) => ` · ${scopeLabel(sc())}`}</Show>
        <Show when={overlapUntil(s())}>{(t) => ` · Overlaps earlier summaries until ${shortDateTime(t())}`}</Show>
      </p>
      <SummaryContent summary={s()} withDay={withDay()} />
    </article>
  );
}
