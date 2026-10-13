// A summary's body: headline, run details, key themes, "For you" and points. The Summary panel and comparisons show it.
import { For, Show } from 'solid-js';
import { CITATION_FLAG_CONFIDENCE, type Summary, type SummaryItem } from '../shared/types';
import { look, providerLabel, formatTokens, usdText, weekdayDate } from '@plugin-sdk/renderer/kit';
import { pointGroups } from './order';
import { runFacts } from './runFacts';
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
export const CHIP = { 'data-size': '2xs', 'data-line': 'chip', 'data-font': 'sans' } as const;
/** A section heading: the channel or day a run of points is about, or the key themes. */
const SECTION_HEAD = { 'data-size': 'md', 'data-weight': 'semibold', 'data-font': 'sans', 'data-tone': 'primary' } as const;
/** A fact's label, over its value. */
const FACT_LABEL = { 'data-size': '2xs', 'data-case': 'upper', 'data-tracking': 'label-sm', 'data-font': 'sans', 'data-tone': 'muted' } as const;
/** A fact's value; `strong`: the cost. */
const factValue = (strong: boolean | undefined) =>
  ({ 'data-size': 'xs', 'data-font': 'sans', 'data-figures': 'tabular', 'data-tone': strong ? 'primary' : 'secondary', ...(strong && { 'data-weight': 'semibold' }) }) as const;

/** An inset divider: a rule stopping short of both edges, between one section of a run and the next. */
const InsetRule = () => <div class={`${styles.insetRule} ${look.ruleAbove}`} data-rule="strong" role="separator" />;

/** What a run read, took, used and cost: labelled facts under the headline. */
function RunFacts(props: { summary: Summary }) {
  const facts = () => runFacts(props.summary, { provider: providerLabel(props.summary.provider), tokens: formatTokens, usd: usdText });
  return (
    <dl class={styles.facts}>
      <For each={facts()}>
        {(f) => (
          <div class={styles.fact} title={f.title}>
            <dt class={look.text} {...FACT_LABEL}>
              {f.label}
            </dt>
            <dd class={look.text} {...factValue(f.strong)}>
              {f.value}
            </dd>
          </div>
        )}
      </For>
    </dl>
  );
}

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

/**
 * `withDay`: the run spans days, so sources show their day. `sourcesOpen`: every point's sources start shown, as an export needs.
 * `runDetails: false` leaves out the run's facts (model, size, cost), for a view that shows them itself (a comparison's column).
 */
export function SummaryContent(props: { summary: Summary; withDay: boolean; sourcesOpen?: boolean; runDetails?: boolean }) {
  const s = () => props.summary;
  return (
    <>
      <p class={`${styles.headline} ${look.text}`} data-size="lg" data-line="relaxed" data-tone="primary">
        <PeopleText text={s().headline} people={s().people} channelId={s().channelIds[0]} />
      </p>
      <Show when={props.runDetails !== false}>
        <InsetRule />
        <RunFacts summary={s()} />
        <InsetRule />
      </Show>
      <Show when={s().themes?.length}>
        <h3 class={`${styles.sectionHead} ${look.text}`} {...SECTION_HEAD}>
          Key themes
        </h3>
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
        <Show when={s().actions.length || s().items.length}>
          <InsetRule />
        </Show>
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
        {(group, i) => (
          <>
            <Show when={i() > 0}>
              <InsetRule />
            </Show>
            <Show when={group.channel}>
              {(ch) => (
                <h3 class={`${styles.sectionHead} ${look.text}`} {...SECTION_HEAD}>
                  #{ch()}
                </h3>
              )}
            </Show>
            <Show when={group.day}>
              {(d) => (
                <h3 class={`${styles.sectionHead} ${look.text}`} {...SECTION_HEAD}>
                  {weekdayDate(d())}
                </h3>
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
