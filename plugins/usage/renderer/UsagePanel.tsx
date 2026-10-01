// The Plan usage panel: every enabled provider's plan windows at once, with what ChattyPop used of each.
import { failure, settled } from '@plugin-sdk/renderer';
import {
  PanelHeader,
  aiText,
  countText,
  formatTokens,
  HeaderActions,
  HeaderButton,
  inCompanion,
  isPanelCollapsed,
  look,
  openSettings,
  planPercentText,
  planUsageFailureOf,
  planUsageLoadingOf,
  planUsageOf,
  providerName,
  refetchPlanUsage,
} from '@plugin-sdk/renderer/kit';
import { MS_PER_DAY, type AppUsage, type PlanUsageWindow, type ProviderId } from '@plugin-sdk/shared';
import { For, Show } from 'solid-js';
import { USAGE_PANEL } from '../shared';
import { appTokens, shownProviders } from './state';
import styles from './Provider.module.css';

const PERCENT_MAX = 100;
/** Plan use above this is shown as a warning. */
const PLAN_WARN_PERCENT = 80;
/** A reset sooner than this shows its time of day; a later one its weekday. */
const RESET_TIME_OF_DAY_WITHIN_MS = MS_PER_DAY;

type Provider = ReturnType<typeof shownProviders>[number];

const warn = (w: PlanUsageWindow): boolean => (w.usedPercent ?? 0) >= PLAN_WARN_PERCENT;
const resetsFull = (w: PlanUsageWindow): string =>
  w.resetsAt ? `Resets ${new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
const resetsShort = (w: PlanUsageWindow): string => {
  if (!w.resetsAt) return '';
  const at = new Date(w.resetsAt);
  return at.getTime() - Date.now() < RESET_TIME_OF_DAY_WITHIN_MS
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString([], { weekday: 'short' });
};

/** ChattyPop's use in window `w` of `id`, for the row's tooltip; empty before it's read. */
function ownUseText(id: ProviderId, w: PlanUsageWindow): string {
  const u: AppUsage | undefined = settled(appTokens)?.[id]?.[w.id];
  if (!u) return '';
  const used = u.runs ? `${countText(u.runs, aiText().singular, aiText().plural)}, ${formatTokens(u.inputTokens)} in · ${formatTokens(u.outputTokens)} out` : aiText().empty;
  return `ChattyPop: ${used}. ${aiText().title}`;
}

/** A provider's brand mark in the text colour, or its name when it declares none. */
function Mark(props: { provider: Provider; class?: string }) {
  return (
    <Show
      when={props.provider.logoPath}
      fallback={
        <span class={`${props.class ?? ''} ${look.text}`} data-size="xs" data-weight="semibold" data-font="sans" data-tone="primary">
          {providerName(props.provider.id)}
        </span>
      }
    >
      {(path) => (
        <svg class={`${props.class ?? ''} ${styles.logo} ${look.text}`} data-tone="primary" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={providerName(props.provider.id)}>
          <title>{providerName(props.provider.id)}</title>
          <path d={path()} />
        </svg>
      )}
    </Show>
  );
}

/** Why `id` shows no meters (failed, no limits, first read pending); undefined once it has windows. */
function statusOf(id: ProviderId): { text: string; error: boolean } | undefined {
  const why = planUsageFailureOf(id);
  if (why) return { text: `Unavailable: ${why}`, error: true };
  const windows = planUsageOf(id);
  if (windows === null) return { text: 'No plan limits reported', error: false };
  return windows?.length ? undefined : { text: 'Reading…', error: false };
}

/** One provider: its mark leads its first row; a row per plan window, or one status row when it has none. */
function ProviderUsage(props: { provider: Provider }) {
  const id = props.provider.id;
  return (
    <section class={styles.provider} aria-label={providerName(id)}>
      <Mark provider={props.provider} class={styles.mark} />
      <Show when={statusOf(id)}>
        {(st) => (
          <span class={`${styles.status} ${st().error ? 'cp-error' : look.text}`} data-size="xs" data-font="sans" data-tone={st().error ? undefined : 'muted'}>
            {st().text}
          </span>
        )}
      </Show>
      <For each={planUsageOf(id) ?? []}>
        {(w) => (
          <div class={styles.meter} title={[`${providerName(id)} ${w.label}`, resetsFull(w), ownUseText(id, w)].filter(Boolean).join('\n')}>
            <span class={`${styles.meterLabel} ${look.text}`} data-size="xs" data-font="sans" data-tone="muted">
              {w.label}
            </span>
            <meter class={`${styles.meterBar} ${look.meter}`} min={0} max={PERCENT_MAX} high={PLAN_WARN_PERCENT} value={w.usedPercent ?? 0} />
            <span
              class={`${styles.meterValue} ${look.text}`}
              data-size="xs"
              data-weight="semibold"
              data-line="tight"
              data-tone={warn(w) ? 'accent' : 'primary'}
              data-warn={warn(w)}
            >
              {planPercentText(w)}
            </span>
            <span class={`${styles.reset} ${look.text}`} data-size="xs" data-font="sans" data-tone="muted">
              {resetsShort(w)}
            </span>
            <Show when={w.note}>
              {(n) => (
                <span class={`${styles.windowNote} ${look.text}`} data-size="xs" data-font="sans" data-tone="muted">
                  {n()}
                </span>
              )}
            </Show>
          </div>
        )}
      </For>
    </section>
  );
}

/**
 * Plan usage for every enabled provider that reports it, side by side when the slot is wide and stacked when narrow:
 * one meter row per plan window (whole-plan %, reset), led by the provider's mark; what ChattyPop itself used is in
 * each row's tooltip. Collapses to its header with each provider's percentages inline.
 */
export function UsagePanel() {
  const collapsed = (): boolean => isPanelCollapsed(USAGE_PANEL);
  const loading = (): boolean => shownProviders().some((d) => planUsageLoadingOf(d.id));

  return (
    <section class={`cp-panel ${styles.root}`} aria-label="Plan usage">
      <PanelHeader
        section={USAGE_PANEL}
        collapsible
        title="Plan usage"
        metaWraps
        meta={
          collapsed() && (
            <span class={`${styles.summaryLine} ${look.text}`} data-size="xs" data-line="tight">
              <For each={shownProviders()}>
                {(d) => (
                  <Show when={planUsageOf(d.id)?.length}>
                    <span class={styles.summaryProvider}>
                      <Mark provider={d} />
                      <For each={planUsageOf(d.id) ?? []}>
                        {(w) => (
                          <span class={look.text} data-tone="muted" data-warn={warn(w)} title={resetsFull(w)}>
                            {w.label}{' '}
                            <b class={look.text} data-weight="semibold" data-tone={warn(w) ? 'accent' : 'primary'}>
                              {planPercentText(w)}
                            </b>
                          </span>
                        )}
                      </For>
                    </span>
                  </Show>
                )}
              </For>
            </span>
          )
        }
      >
        <HeaderActions>
          <HeaderButton
            variant="icon"
            aria-label="Refresh plan usage"
            title="Refresh"
            disabled={loading()}
            onClick={() => refetchPlanUsage()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.5" />
              <path d="M20 3.5v5h-5" />
            </svg>
          </HeaderButton>
        </HeaderActions>
      </PanelHeader>
      <Show when={!collapsed()}>
        <div id="plan-usage-body" class={styles.body} data-fit-body>
          <Show
            when={shownProviders().length > 0}
            fallback={
              <p class={look.text} data-size="md" data-tone="muted">
                No AI provider with plan limits enabled.{' '}
                <Show when={!inCompanion} fallback="Turn one on in Settings on your PC.">
                  <button type="button" class={look.link} data-underline="always" onClick={() => openSettings()}>
                    Open Settings
                  </button>
                </Show>
              </p>
            }
          >
            <Show when={failure(appTokens)}>{(why) => <p class="cp-error">ChattyPop's own use unavailable: {why()}</p>}</Show>
            <div class={styles.providers}>
              <For each={shownProviders()}>{(d) => <ProviderUsage provider={d} />}</For>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}
