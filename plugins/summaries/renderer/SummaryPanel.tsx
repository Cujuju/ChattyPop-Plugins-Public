// Summary history, controls and cited results.
import { For, Show, createSignal, createUniqueId } from 'solid-js';
import type { Summary } from '../shared/types';
import { SUMMARY_RANGES, type SummaryRange, type SummaryTrigger } from '../shared/settings';
import {
  look,
  createFollowBottom,
  Icon,
  clockTime,
  shortDateTime,
  weekdayDateTime,
  isPanelCollapsed,
  PanelHeader,
  HeaderActions,
  HeaderButton,
  listen,
  scrolledFromTop,
  ProviderSelect,
  Select,
} from '@plugin-sdk/renderer/kit';
import { patchSummarySettings, summarySettings } from './settings';
import {
  loadOlderSummaries,
  overlapUntil,
  runSummary,
  setSummaryRange,
  setSummaryScope,
  summaryError,
  summaryHistory,
  summaryProgress,
  summaryRange,
  summaryRunning,
  summaryScope,
} from './state';
import { ScopeSelect, scopeLabel } from './scope';
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

/** One header action opens the same summary controls on desktop and phone. */
function SummaryControls() {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let trigger!: HTMLButtonElement;
  let panel!: HTMLDivElement;
  const place = (): void => {
    if (!panel.matches(':popover-open')) return;
    const css = getComputedStyle(panel);
    const inset = parseFloat(css.getPropertyValue('--cp-space-3'));
    const gap = parseFloat(css.getPropertyValue('--cp-popover-gap'));
    const anchor = trigger.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const below = anchor.bottom + gap;
    const top = below + bounds.height > innerHeight - inset ? anchor.top - gap - bounds.height : below;
    panel.style.left = `${Math.max(inset, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - inset))}px`;
    panel.style.top = `${Math.max(inset, Math.min(top, innerHeight - bounds.height - inset))}px`;
  };
  const close = (): void => {
    panel.hidePopover();
    trigger.focus();
  };
  listen(window, 'resize', place);
  listen(window, 'scroll', place, { capture: true, passive: true });
  listen(window, 'keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !panel.matches(':popover-open')) return;
    e.preventDefault();
    close();
  });
  return (
    <>
      <HeaderButton
        ref={trigger}
        variant="primaryIcon"
        aria-label="Summary options"
        title="Summary options"
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={id}
        popovertarget={id}
      >
        <Icon name="summary" />
      </HeaderButton>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        class={`cp-popover ${styles.runPanel}`}
        onToggle={(e) => {
          const shown = (e as ToggleEvent).newState === 'open';
          setOpen(shown);
          if (shown) {
            place();
            panel.querySelector<HTMLSelectElement>('select')?.focus();
          }
        }}
      >
        <div class={styles.runHead}>
          <h3 id={`${id}-title`} class={look.text} data-size="md" data-weight="semibold">Summary options</h3>
          <HeaderButton variant="icon" aria-label="Close summary options" onClick={close}><Icon name="close" /></HeaderButton>
        </div>
        <div class={styles.runField}>
          <label for={`${id}-provider`} class={look.text} data-size="sm">Provider</label>
          <ProviderSelect
            id={`${id}-provider`}
            class={styles.runSelect}
            value={summarySettings().defaultProvider}
            onChange={(defaultProvider) => patchSummarySettings({ defaultProvider })}
          />
        </div>
        <div class={styles.runField}>
          <label for={`${id}-channels`} class={look.text} data-size="sm">Channels</label>
          <ScopeSelect id={`${id}-channels`} class={styles.runSelect} value={summaryScope()} onChange={setSummaryScope} />
        </div>
        <div class={styles.runField}>
          <label for={`${id}-range`} class={look.text} data-size="sm">Time frame</label>
          <Select
            id={`${id}-range`}
            class={styles.runSelect}
            value={summaryRange()}
            options={Object.entries(SUMMARY_RANGES).map(([value, r]) => ({ value, label: r.label }))}
            onChange={(v) => setSummaryRange(v as SummaryRange)}
          />
        </div>
        <button
          type="button"
          class="cp-primary cp-primary-lg"
          disabled={summaryRunning()}
          onClick={() => {
            close();
            void runSummary();
          }}
        >
          {summaryRunning() ? 'Working…' : 'Run summary'}
        </button>
      </div>
    </>
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
