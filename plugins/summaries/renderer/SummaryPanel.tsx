// Summary history, controls and cited results.
import { For, Show, createEffect, createMemo } from 'solid-js';
import type { Summary, SummaryRunFailure } from '../shared/types';
import type { SummaryTrigger } from '../shared/settings';
import {
  look,
  createFollowBottom,
  clockTime,
  now,
  shortDateTime,
  weekdayDate,
  weekdayDateTime,
  isPanelCollapsed,
  PanelHeader,
  HeaderActions,
  scrolledFromTop,
} from '@plugin-sdk/renderer/kit';
import { namedText } from '../shared/people';
import {
  isRetrying,
  isSummaryOpen,
  latestSummary,
  loadOlderSummaries,
  overlapUntil,
  retryFailure,
  summaryError,
  summaryFailures,
  summaryHistory,
  summaryProgress,
  summaryRunning,
  toggleSummary,
} from './state';
import { historyEntries, isFailure } from './historyPage';
import { scopeLabel } from './scope';
import { SummaryControls } from './SummaryControls';
import { spansDays } from './order';
import styles from './Summary.module.css';
import { CHIP, META, SummaryContent } from './SummaryContent';

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

/** F2 Summary: range and run; every run kept, oldest at the top and newest at the bottom, each folding under the time it covers. */
export function SummaryPanel() {
  const log = createFollowBottom();
  let body!: HTMLDivElement;
  // Within a screen of the top, load older runs and keep what is on screen in place.
  const onScroll = async (): Promise<void> => {
    if (scrolledFromTop(body) > body.clientHeight) return;
    const before = body.scrollHeight;
    if (await loadOlderSummaries()) body.scrollTop += body.scrollHeight - before;
  };
  // Folded runs may not fill the panel, and then nothing scrolls: older runs load until they do, or none are left.
  createEffect(() => {
    void summaryHistory.items.length;
    for (const s of summaryHistory.items) isSummaryOpen(s.id);
    if (isPanelCollapsed('summary') || summaryHistory.reachedStart) return;
    queueMicrotask(() => {
      if (body?.isConnected && body.scrollHeight <= body.clientHeight) void loadOlderSummaries();
    });
  });
  const entries = createMemo(() => historyEntries(summaryHistory.items, summaryFailures(), summaryHistory.reachedStart));
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
          <Show when={entries().length === 0 && !summaryRunning()}>
            <p class={look.text} data-size="md" data-tone="muted">No summary yet. Open summary options, pick a time frame, and press Run summary.</p>
          </Show>
          <For each={entries()}>
            {(e) => (isFailure(e) ? <FailedRun failure={e} /> : <SummaryRun summary={e} />)}
          </For>
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

type Span = Pick<Summary, 'sinceTs' | 'untilTs'>;

/** The time a run covers, its title: clock times within one day, each end with its day across days. */
function RunRange(props: { span: Span }) {
  const end = (ms: number): string => (spansDays(props.span) ? weekdayDateTime(ms) : clockTime(ms));
  return (
    <span class={look.text} data-size="md" data-weight="semibold" data-font="sans" data-figures="tabular" data-tone="primary">
      <time dateTime={isoTime(props.span.sinceTs)}>{end(props.span.sinceTs)}</time>
      {' – '}
      <time dateTime={isoTime(props.span.untilTs)}>{end(props.span.untilTs)}</time>
    </span>
  );
}

/** Beside the title: the day of a run within one day, then what ran it and what it read; a repeated part shows once. */
const runAside = (span: Span, parts: (string | false | null | undefined)[]): string =>
  [...new Set([spansDays(span) ? null : weekdayDate(span.sinceTs), ...parts].filter(Boolean))].join(' · ');

/** One run: a heading card with the time it covers; a click on it or its body folds the body. Folded, the card adds the headline. */
function SummaryRun(props: { summary: Summary }) {
  const s = () => props.summary;
  const open = () => isSummaryOpen(s().id);
  const overlap = () => overlapUntil(s());
  const latest = () => latestSummary()?.id === s().id;
  const title = () =>
    [`Ran ${weekdayDateTime(s().createdAt)}`, overlap() !== null && `Covers time earlier summaries cover, until ${shortDateTime(overlap()!)}`].filter(Boolean).join('. ');
  let run!: HTMLElement;
  let heading!: HTMLButtonElement;
  // A click anywhere in the run folds or unfolds it: its heading, or its body outside the controls there.
  const onClick = (e: MouseEvent): void => {
    const control = (e.target as Element).closest('button, a');
    if (control && control !== heading) return;
    // A drag that selected text in it ends in a click too: that keeps it open.
    const picked = window.getSelection();
    if (picked && !picked.isCollapsed && run.contains(picked.anchorNode)) return;
    toggleSummary(s().id);
    // Folded from far down its body, its heading is above the view: it comes back in.
    if (!open()) heading.scrollIntoView({ block: 'nearest' });
  };
  return (
    <article ref={run} class={styles.summary} onClick={onClick}>
      <button
        ref={heading}
        type="button"
        class={`${styles.runToggle} ${look.disclosure} ${look.card} ${look.row}`}
        aria-expanded={open()}
        title={title()}
      >
        <span class="cp-chevron" aria-hidden="true" />
        <span class={styles.rowHead}>
          <span class={styles.markedRange}>
            <RunRange span={s()} />
            <Show when={latest()}>
              <span class={`${styles.mark} ${look.countBadge} ${look.text}`} {...CHIP} data-weight="semibold">
                Latest
              </span>
            </Show>
          </span>
          <span class={look.text} {...META}>
            {runAside(s(), [TRIGGER_TEXT[s().trigger], s().scope && scopeLabel(s().scope), overlap() !== null && 'overlaps earlier'])}
          </span>
        </span>
        <Show when={!open()}>
          <span class={`${styles.runTeaser} ${look.text}`} data-size="md" data-line="normal" data-tone="secondary">
            {namedText(s().headline, s().people)}
          </span>
        </Show>
      </button>
      <Show when={open()}>
        <SummaryContent summary={s()} withDay={spansDays(s())} />
      </Show>
    </article>
  );
}

/** A timed run that failed, where its summary would be: when it covers, why it failed, when it is tried again, and Retry. */
function FailedRun(props: { failure: SummaryRunFailure }) {
  const f = () => props.failure;
  const next = (): string => {
    const at = f().retryAt;
    if (at === null) return 'Not retried automatically.';
    return at > now() ? `Tries again at ${clockTime(at)}.` : 'Tries again within a minute.';
  };
  return (
    <article class={styles.summary} aria-label="Failed summary">
      <div class={`${styles.failure} ${look.banner}`}>
        <span class={styles.rowHead}>
          <span class={styles.markedRange}>
            <span class={`${styles.mark} ${look.status} ${look.text}`} {...CHIP} data-tint="danger">
              Failed
            </span>
            <RunRange span={f()} />
          </span>
          <span class={look.text} {...META}>
            {runAside(f(), [TRIGGER_TEXT[f().trigger], f().ruleName])}
          </span>
        </span>
        <p class={`${styles.error} ${look.text}`} data-size="md" data-line="normal" data-tone="danger">
          {f().message || 'The summary failed.'}
        </p>
        <div class={styles.failureFoot}>
          <span class={look.text} {...META}>
            {isRetrying(f()) ? 'Trying again now.' : next()}
          </span>
          <button
            type="button"
            class={`${styles.retryButton} ${look.button} ${look.text}`}
            data-variant="raised"
            data-size="xs"
            data-weight="semibold"
            data-font="sans"
            disabled={isRetrying(f())}
            onClick={() => void retryFailure(f())}
          >
            {isRetrying(f()) ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      </div>
    </article>
  );
}
