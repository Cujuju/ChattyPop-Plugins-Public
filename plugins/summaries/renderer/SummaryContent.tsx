// A summary's body: headline, run details, "For you", points and key themes. The Summary panel and comparisons show it.
import { For, Show } from 'solid-js';
import { CITATION_FLAG_CONFIDENCE, type Summary, type SummaryItem } from '../shared/types';
import { MS_PER_S } from '@plugin-sdk/shared';
import { look, providerLabel, formatTokens, usdText, weekdayDate } from '@plugin-sdk/renderer/kit';
import { pointGroups } from './order';
import styles from './Summary.module.css';
import { PeopleText } from './People';
import { Sources } from './Sources';

/** Source chips a key theme shows once expanded; "+N more" counts the rest Jev sorted under it. */
const THEME_CHIPS = 6;

export const FLAG_TEXT = { contradicted: 'Cited messages contradict this', unsupported: "Cited messages don't back this", uncited: 'No citation' } as const;

/** Each flag's status tint; unset is the default (a second look). */
const FLAG_TINT: Record<keyof typeof FLAG_TEXT, 'danger' | 'neutral' | undefined> = { contradicted: 'danger', unsupported: undefined, uncited: 'neutral' };

/** Run details: muted small print. */
export const META = { 'data-size': 'xs', 'data-line': 'normal', 'data-font': 'sans', 'data-tone': 'muted' } as const;
/** A point's text. */
const POINT = { 'data-size': 'base', 'data-line': 'relaxed' } as const;
/** A chip's text: citations and flags. */
const CHIP = { 'data-size': '2xs', 'data-line': 'chip', 'data-font': 'sans' } as const;
/** A group heading: the channel or day a run of points is about. */
const GROUP_HEAD = { 'data-size': 'xs', 'data-weight': 'semibold', 'data-font': 'sans', 'data-tone': 'muted' } as const;

/** A bullet worth a second look: the check disagreed with confidence, or there was nothing to check. */
export function flagOf(item: SummaryItem): keyof typeof FLAG_TEXT | null {
  const c = item.check;
  if (!c || c.verdict === 'supported') return null;
  if (c.verdict === 'uncited') return 'uncited';
  return (c.confidence ?? 0) >= CITATION_FLAG_CONFIDENCE ? c.verdict : null;
}

/** Tokens: each run that called a model says what it used, or that its provider didn't report it. */
export function tokenParts(s: Summary): string[] {
  const u = s.usage;
  if (!u) return s.messageCount > 0 ? ['tokens not reported'] : [];
  return [`${formatTokens(u.inputTokens)} in${u.cachedInputTokens ? ` (${formatTokens(u.cachedInputTokens)} cached)` : ''}`, `${formatTokens(u.outputTokens)} out`];
}

/** Costs: the model's at API rates, or that it is unknown, then Jev's. */
export function costParts(s: Summary): string[] {
  return [
    ...(s.apiCostUsd !== null
      ? [`≈${usdText(s.apiCostUsd)} at API rates${s.apiCostEstimated ? ' (estimated from tokens)' : ''}`]
      : s.messageCount > 0 ? ['API cost unknown'] : []),
    ...(s.jevCostUsd !== null ? [`Jev ${usdText(s.jevCostUsd)}`] : []),
  ];
}

/** Tokens, then costs. */
export const usageParts = (s: Summary): string[] => [...tokenParts(s), ...costParts(s)];

/**
 * `withDay`: the run spans days, so sources show their day. `sourcesOpen`: every point's sources start shown, as an export needs.
 * `runDetails: false` leaves out the provider, size and cost line, for a view that shows them itself (a comparison's column).
 */
export function SummaryContent(props: { summary: Summary; withDay: boolean; sourcesOpen?: boolean; runDetails?: boolean }) {
  const s = () => props.summary;
  return (
    <>
      <p class={`${styles.headline} ${look.text}`} data-size="lg" data-weight="semibold" data-line="normal" data-tone="primary">
        <PeopleText text={s().headline} people={s().people} channelId={s().channelIds[0]} />
      </p>
      <Show when={props.runDetails !== false}>
        <p class={`${styles.meta} ${look.text}`} {...META}>
          {providerLabel(s().provider)}
          <Show when={s().model}>{(m) => ` (${m()})`}</Show> · {s().messageCount} messages
          <Show when={s().skippedCount > 0}>{` (${s().skippedCount} skipped as filler)`}</Show> · {Math.round(s().durationMs / MS_PER_S)} s
          <Show when={usageParts(s()).length}>{` · ${usageParts(s()).join(' · ')}`}</Show>
        </p>
      </Show>
      <Show when={s().actions.length}>
        <section class={`${styles.actions} ${look.wash}`} aria-label="For you">
          <p class={look.text} data-size="xs" data-weight="semibold" data-case="upper" data-tracking="label" data-font="sans" data-tone="section">
            For you
          </p>
          <ul class={styles.actionList}>
            <For each={s().actions}>
              {(action) => (
                <li class={`${styles.action} ${look.text}`} {...POINT} data-tone="primary">
                  <PointParts item={action} summary={s()} withDay={props.withDay} sourcesOpen={props.sourcesOpen} />
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
                    <PointParts item={item} summary={s()} withDay={props.withDay} sourcesOpen={props.sourcesOpen} />
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
                <Sources citations={t.citations} summary={s()} withDay={props.withDay} limit={THEME_CHIPS} shown={props.sourcesOpen} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </>
  );
}

/** A point's parts, each followed by its own sources, so a source sits next to the thread it backs. */
function PointParts(props: { item: SummaryItem; summary: Summary; withDay: boolean; sourcesOpen?: boolean }) {
  return (
    <For each={props.item.parts}>
      {(part, i) => (
        <>
          {i() ? ' ' : ''}
          <span class={styles.itemText}>
            <PeopleText text={part.text} people={props.summary.people} channelId={part.citations[0]?.channelId ?? props.summary.channelIds[0]} />
          </span>
          <Sources citations={part.citations} summary={props.summary} withDay={props.withDay} shown={props.sourcesOpen} />
        </>
      )}
    </For>
  );
}
