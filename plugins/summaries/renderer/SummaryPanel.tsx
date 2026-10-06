// Summary history, controls and cited results.
import { For, Show } from 'solid-js';
import { CITATION_FLAG_CONFIDENCE, type Summary, type SummaryItem } from '../shared/types';
import { SUMMARY_RANGES, type SummaryRange, type SummaryTrigger } from '../shared/settings';
import { MS_PER_S } from '@plugin-sdk/shared';
import {
  look,
  providerLabel,
  createFollowBottom,
  Icon,
  clockTime,
  formatTokens,
  shortDateTime,
  usdText,
  weekdayDate,
  weekdayDateTime,
  isPanelCollapsed,
  PanelHeader,
  HeaderActions,
  HeaderButton,
  inCompanion,
  scrolledFromTop,
  Select,
} from '@plugin-sdk/renderer/kit';
import {
  loadOlderSummaries,
  overlapUntil,
  runSummary,
  setSummaryRange,
  summaryError,
  summaryHistory,
  summaryProgress,
  summaryRange,
  summaryRunning,
} from './state';
import { pointGroups, spansDays } from './order';
import styles from './Summary.module.css';
import { PeopleText } from './People';
import { Sources } from './Sources';

/** Source chips a key theme shows once expanded; "+N more" counts the rest Jev sorted under it. */
const THEME_CHIPS = 6;

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

const FLAG_TEXT = { contradicted: 'Cited messages contradict this', unsupported: "Cited messages don't back this", uncited: 'No citation' } as const;

/** Each flag's status tint; unset is the default (a second look). */
const FLAG_TINT: Record<keyof typeof FLAG_TEXT, 'danger' | 'neutral' | undefined> = { contradicted: 'danger', unsupported: undefined, uncited: 'neutral' };

/** Run details: muted small print. */
const META = { 'data-size': 'xs', 'data-line': 'normal', 'data-font': 'sans', 'data-tone': 'muted' } as const;
/** A point's text. */
const POINT = { 'data-size': 'base', 'data-line': 'relaxed' } as const;
/** A chip's text: citations and flags. */
const CHIP = { 'data-size': '2xs', 'data-line': 'chip', 'data-font': 'sans' } as const;
/** A group heading: the channel or day a run of points is about. */
const GROUP_HEAD = { 'data-size': 'xs', 'data-weight': 'semibold', 'data-font': 'sans', 'data-tone': 'muted' } as const;

/** A bullet worth a second look: the check disagreed with confidence, or there was nothing to check. */
function flagOf(item: SummaryItem): keyof typeof FLAG_TEXT | null {
  const c = item.check;
  if (!c || c.verdict === 'supported') return null;
  if (c.verdict === 'uncited') return 'uncited';
  return (c.confidence ?? 0) >= CITATION_FLAG_CONFIDENCE ? c.verdict : null;
}

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
        {/* Phone range and Summarize controls sit between the title and app bar controls. */}
        <HeaderActions align={inCompanion ? 'center' : 'end'}>
          <Select
            class={styles.select}
            label="Range"
            value={summaryRange()}
            options={Object.entries(SUMMARY_RANGES).map(([id, r]) => ({ value: id, label: r.label }))}
            onChange={(v) => setSummaryRange(v as SummaryRange)}
          />
          <HeaderButton
            variant="primaryIcon"
            aria-label={summaryRunning() ? 'Working' : 'Summarize'}
            title={summaryRunning() ? 'Working' : 'Summarize'}
            disabled={summaryRunning()}
            onClick={() => void runSummary()}
          >
            <Icon name="summary" />
          </HeaderButton>
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
            <p class={look.text} data-size="md" data-tone="muted">No summary yet. Pick a range and press Summarize.</p>
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

/** One run, headed by the time it covers: headline, run details, what needs the reader, and points in the order they happened. */
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
        <Show when={overlapUntil(s())}>{(t) => ` · Overlaps earlier summaries until ${shortDateTime(t())}`}</Show>
      </p>
      <p class={`${styles.headline} ${look.text}`} data-size="lg" data-weight="semibold" data-line="normal" data-tone="primary">
        <PeopleText text={s().headline} people={s().people} channelId={s().channelIds[0]} />
      </p>
      <p class={`${styles.meta} ${look.text}`} {...META}>
        {providerLabel(s().provider)}
        <Show when={s().model}>{(m) => ` (${m()})`}</Show> · {s().messageCount} messages
        <Show when={s().skippedCount > 0}>{` (${s().skippedCount} skipped as filler)`}</Show> · {Math.round(s().durationMs / MS_PER_S)} s
        <Show when={s().usage}>
          {(u) => ` · ${formatTokens(u().inputTokens)} in${u().cachedInputTokens ? ` (${formatTokens(u().cachedInputTokens)} cached)` : ''} · ${formatTokens(u().outputTokens)} out`}
        </Show>
        <Show when={s().apiCostUsd !== null}>{` · ≈${usdText(s().apiCostUsd!)} at API rates${s().apiCostEstimated ? ' (estimated from tokens)' : ''}`}</Show>
        <Show when={s().jevCostUsd !== null}>{` · Jev ${usdText(s().jevCostUsd!)}`}</Show>
      </p>
      <Show when={s().actions.length}>
        <section class={`${styles.actions} ${look.wash}`} aria-label="For you">
          <p class={look.text} data-size="xs" data-weight="semibold" data-case="upper" data-tracking="label" data-font="sans" data-tone="section">
            For you
          </p>
          <ul class={styles.actionList}>
            <For each={s().actions}>
              {(action) => (
                <li class={`${styles.action} ${look.text}`} {...POINT} data-tone="primary">
                  <PointParts item={action} summary={s()} withDay={withDay()} />
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <For each={pointGroups(s())}>
        {(group) => (
          <>
            <Show when={group.channel}>
              {(ch) => (
                <p class={`${styles.channelHead} ${look.text}`} {...GROUP_HEAD}>
                  #{ch()}
                </p>
              )}
            </Show>
            <Show when={group.day}>
              {(d) => (
                <p class={`${styles.channelHead} ${look.text}`} {...GROUP_HEAD}>
                  {weekdayDate(d())}
                </p>
              )}
            </Show>
            <ol class={styles.items}>
              <For each={group.items}>
                {(item) => (
                  <li class={`${styles.item} ${look.numbered} ${look.text}`} {...POINT} data-tone="secondary">
                    <PointParts item={item} summary={s()} withDay={withDay()} />
                    <Show when={flagOf(item)}>
                      {(f) => (
                        <span
                          class={`${styles.flag} ${look.status} ${look.text}`}
                          {...CHIP}
                          data-tint={FLAG_TINT[f()]}
                          data-verdict={f()}
                          title="Jev's check of this point against the messages it cites"
                        >
                          {FLAG_TEXT[f()]}
                        </span>
                      )}
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          </>
        )}
      </For>
      <Show when={s().themes?.length}>
        <p class={`${styles.meta} ${look.text}`} {...META}>
          Key themes
        </p>
        <ul class={styles.items}>
          <For each={s().themes!}>
            {(t) => (
              <li class={`${styles.item} ${look.numbered} ${look.text}`} {...POINT} data-tone="secondary">
                <span class={styles.itemText}>
                  <PeopleText text={t.title} people={s().people} channelId={t.citations[0]?.channelId ?? s().channelIds[0]} />
                </span>
                <Sources citations={t.citations} summary={s()} withDay={withDay()} limit={THEME_CHIPS} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </article>
  );
}

/** A point's parts, each followed by its own sources, so a source sits next to the thread it backs. */
function PointParts(props: { item: SummaryItem; summary: Summary; withDay: boolean }) {
  return (
    <For each={props.item.parts}>
      {(part, i) => (
        <>
          {i() ? ' ' : ''}
          <span class={styles.itemText}>
            <PeopleText text={part.text} people={props.summary.people} channelId={part.citations[0]?.channelId ?? props.summary.channelIds[0]} />
          </span>
          <Sources citations={part.citations} summary={props.summary} withDay={props.withDay} />
        </>
      )}
    </For>
  );
}
