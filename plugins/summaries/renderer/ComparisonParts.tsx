// A comparison's details line and its column per model: the open comparison shows them, and its exports are snapshots of them.
import { For, Show } from 'solid-js';
import { countText, look } from '@plugin-sdk/renderer/kit';
import type { Comparison } from '../shared/compare';
import { inputCheck, modelText, rangeText, sameInput, totalsText } from './compareState';
import { spansDays } from './order';
import { scopeLabel } from './scope';
import { META, SummaryContent } from './SummaryContent';
import styles from './Summary.module.css';

/** What every model read and used in total, and whether each was sent the same input. */
export function ComparisonMeta(props: { comparison: Comparison }) {
  const c = () => props.comparison;
  const head = () =>
    [
      scopeLabel(c().scope),
      rangeText(c().sinceTs, c().untilTs),
      `${countText(c().messageCount, 'message')}${c().skippedCount ? ` (${c().skippedCount} skipped)` : ''}`,
      totalsText(c()),
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <p class={`${styles.meta} ${look.text}`} {...META}>
      {head()}
      <Show when={inputCheck(c())}>
        {(check) => (
          <>
            <br />
            <span class={look.text} data-tone={check().ok ? 'success' : 'danger'} role={check().ok ? undefined : 'alert'}>
              {check().text}
            </span>
          </>
        )}
      </Show>
    </p>
  );
}

/** A column per model in list order; `sourcesOpen` shows every point's sources, as an export does. */
export function ComparisonColumns(props: { comparison: Comparison; sourcesOpen?: boolean }) {
  const c = () => props.comparison;
  return (
    <div class={styles.columns}>
      <For each={c().results}>
        {(r) => (
          <article class={`${styles.column} ${look.card}`} aria-label={modelText(r.model)}>
            <p class={look.text} data-size="sm" data-weight="semibold" data-font="sans" data-tone="primary">
              {modelText(r.model)}
            </p>
            <Show when={sameInput(c(), r) === false}>
              <p class={look.text} data-size="xs" data-tone="danger" role="alert">
                This model was sent different input from the others.
              </p>
            </Show>
            <Show
              when={r.summary}
              fallback={
                <p class={`${styles.error} ${look.text}`} data-size="md" data-tone="danger" role="alert">
                  {r.error}
                </p>
              }
            >
              {(s) => <SummaryContent summary={s()} withDay={spansDays(s())} sourcesOpen={props.sourcesOpen} />}
            </Show>
          </article>
        )}
      </For>
    </div>
  );
}
