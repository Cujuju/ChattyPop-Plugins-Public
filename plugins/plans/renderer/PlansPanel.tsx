import { For, Show } from 'solid-js';
import type { PlanItem } from '../shared/types';
import { isPanelCollapsed, jevSwitch, look, now, openArchive, PanelHeader, weekdayDateTime as when } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import { plans } from './state';
import styles from './Plans.module.css';

const planDetection = jevSwitch(plugin, 'planDetection');

/** A group heading: the uppercase micro label. */
const GROUP_LABEL = { 'data-size': '2xs', 'data-weight': 'semibold', 'data-case': 'upper', 'data-tracking': 'label-sm', 'data-tone': 'muted' } as const;

/** #67: plans (soonest first; past ones dimmed) and decisions (newest first), each opening its message. */
export function PlansPanel() {
  const planned = () => plans().filter((p) => p.kind === 'plan');
  const decided = () => plans().filter((p) => p.kind === 'decision');
  return (
    <section class={styles.root} aria-label="Plans and decisions" data-section="plans">
      <PanelHeader
        section="plans"
        collapsible
        title="Plans & decisions"
        meta={plans().length ? `${planned().length} plans · ${decided().length} decisions` : undefined}
      />
      <Show when={!isPanelCollapsed('plans')}>
        <div class={styles.body}>
          <Show
            when={plans().length}
            fallback={
              <p class={`${styles.empty} ${look.text}`} data-size="sm" data-tone="muted">
                {planDetection.on()
                  ? 'No plans or decisions spotted yet. New messages are checked as they arrive.'
                  : 'Turn on Settings → Jev → Detect plans and decisions to collect them here.'}
              </p>
            }
          >
            <Show when={planned().length}>
              <h3 class={`${styles.group} ${look.text}`} {...GROUP_LABEL}>Plans</h3>
              <For each={planned()}>{(p) => <Row item={p} past={p.whenTs !== null && p.whenTs < now()} />}</For>
            </Show>
            <Show when={decided().length}>
              <h3 class={`${styles.group} ${look.text}`} {...GROUP_LABEL}>Decisions</h3>
              <For each={decided()}>{(p) => <Row item={p} past={false} />}</For>
            </Show>
          </Show>
        </div>
      </Show>
    </section>
  );
}

function Row(props: { item: PlanItem; past: boolean }) {
  const p = () => props.item;
  return (
    <button
      type="button"
      class={`${styles.row} ${look.row}`}
      data-past={props.past}
      data-state={props.past ? 'dimmed' : undefined}
      onClick={() => void openArchive(p().channelId, p().messageId)}
      title="Show the message in the Archive"
    >
      <span class={`${styles.when} ${look.text}`} data-size="xs" data-tone="section" data-figures="tabular">{p().kind === 'plan' ? (p().whenTs !== null ? when(p().whenTs!) : 'No date') : when(p().ts)}</span>
      <span class={look.text} data-size="md" data-tone="primary">{p().title}</span>
      <span class={look.text} data-size="xs" data-tone="muted">
        #{p().channelName}
        <Show when={p().who.length}> · {p().who.join(', ')}</Show>
      </span>
      <Show when={p().details}>
        <span class={look.text} data-size="xs" data-tone="muted">{p().details}</span>
      </Show>
    </button>
  );
}
