// Summary preferences, schedules and prompts.
import { For, Show } from 'solid-js';
import type { Rule } from '@plugin-sdk/shared';
import { timedTriggerText } from '@plugin-sdk/shared';
import {
  SUMMARY_BULLETS,
  SUMMARY_FOCUS_MAX_CHARS,
  SUMMARY_RANGES,
  type SummaryGrouping,
  type SummaryLength,
  type SummaryRange,
} from '../shared/settings';
import { DEFAULT_SUMMARY_PROMPTS } from '../shared/prompts';
import { patchSummarySettings as update, summarySettings } from './settings';
import {
  openRule,
  rules,
  startNewRule,
  Select,
  Switch,
  Card,
  Note,
  Row,
  SectionsPage,
  choiceOptions,
  countText,
  createAction,
  formatTokens,
  LinkButton,
  look,
  openSettingsAt,
  providerLabel,
  providerName,
  providerSettingsOf,
  ProviderSelect,
  providerStatus,
  usdText,
  type ChoiceText,
} from '@plugin-sdk/renderer/kit';
import styles from './Summary.module.css';
import { createPromptPreview, createSpending, SPEND_PERIODS } from './state';
import type { ProviderSpend, SummarySpend } from '../shared/types';
import { WEEKDAY_LABELS as DAY_NAMES } from '@plugin-sdk/shared';
import { SummaryPromptEditor } from './SummaryPromptEditor';
import { CompareBody } from './Compare';
import { ScopeSelect, ruleScope, setRuleScope } from './scope';

/** Settings → AI: where each provider's model is picked. */
const AI_SETTINGS = 'ai';
const span = (b: readonly [number, number]): string => `${b[0]}–${b[1]}`;
const LENGTH_LABEL: Record<SummaryLength, string> = { brief: 'Brief', standard: 'Standard', detailed: 'Detailed' };
/** Each layout's text in its select and in the section's one-line state, in select order. */
const GROUPINGS: Record<SummaryGrouping, ChoiceText> = {
  overall: { option: 'One list, in the order it happened', meta: 'one list' },
  channel: { option: 'Grouped by channel', meta: 'grouped by channel' },
};

/** #96 rules that summarize on a schedule: the automatic summaries. */
const scheduledSummaries = (): Rule[] =>
  rules().filter(
    (r) => r.spec.trigger.type === 'timed' && r.spec.actions.some((a) => a.type === 'summaries.summarize'),
  );

/** Settings → Summaries: what a summary contains, and summaries that run on their own. */
export function SummarySection() {
  const s = summarySettings;
  const autoMeta = (): string => {
    const on = scheduledSummaries().filter((r) => r.enabled).length;
    return on ? `${on} on` : 'Off';
  };
  const spending = createSpending();
  // The widest window, in the section's one-line state.
  const spendMeta = (): string => {
    const last = spending().at(-1);
    return last ? `≈${usdText(spendTotal(last))} ${SPEND_PERIODS.at(-1)!.label.toLowerCase()}` : '';
  };
  return (
    <SectionsPage
      id="summaries"
      title="Summaries"
      lede="Which AI provider writes summaries, what a summary contains, and the summaries that run on their own."
      sections={[
        { id: 'provider', label: 'Provider', meta: () => (s().defaultProvider ? providerLabel(s().defaultProvider!) : 'None chosen'), body: ProviderBody },
        {
          id: 'style',
          label: 'Summary style',
          divider: true,
          meta: () => `${LENGTH_LABEL[s().length]} · ${GROUPINGS[s().grouping].meta}`,
          body: StyleBody,
        },
        { id: 'auto', label: 'Automatic summaries', meta: autoMeta, body: AutoBody },
        { id: 'spending', label: 'Spending', meta: spendMeta, body: () => <SpendingBody spending={spending} /> },
        { id: 'compare', label: 'Compare models', divider: true, meta: () => countText(s().compareModels.length, 'model'), body: CompareBody },
        {
          id: 'prompts',
          label: 'Prompts',
          meta: () => (Object.values(s().prompts).some((t) => t !== null) ? 'Customized' : 'Default'),
          body: PromptsBody,
        },
      ]}
    />
  );
}

/** The provider every summary uses, automatic ones included; its model is the one Settings → AI picks for it. */
function ProviderBody() {
  const s = summarySettings;
  const model = (): string | null => {
    const id = s().defaultProvider;
    if (!id) return null;
    const chosen = providerSettingsOf(id).model;
    const listed = providerStatus().find((p) => p.id === id)?.models;
    return listed?.find((m) => (chosen ? m.id === chosen : m.isDefault))?.label ?? chosen ?? 'provider default';
  };
  return (
    <Card>
      <Row
        label="Provider"
        for="summary-provider"
        hint={
          <>
            Every summary uses it, automatic ones included{model() ? `, with ${model()}` : ''}. Its model is picked in Settings → AI providers.{' '}
            <LinkButton onClick={() => openSettingsAt(AI_SETTINGS)}>Open Settings → AI providers</LinkButton>
          </>
        }
        control={<ProviderSelect id="summary-provider" value={s().defaultProvider} onChange={(defaultProvider) => update({ defaultProvider })} />}
      />
    </Card>
  );
}

function StyleBody() {
  const s = summarySettings;
  return (
    <>
      <Card title="Shape">
        <Row
          label="Length"
          for="summary-length"
          hint={`${span(SUMMARY_BULLETS[s().length].overall)} points (${span(SUMMARY_BULLETS[s().length].perChannel)} per channel).`}
          control={
            <Select
              id="summary-length"
              class={styles.control}
              value={s().length}
              options={(Object.keys(LENGTH_LABEL) as SummaryLength[]).map((l) => ({
                value: l,
                label: `${LENGTH_LABEL[l]}: ${span(SUMMARY_BULLETS[l].overall)} points`,
              }))}
              onChange={(v) => update({ length: v as SummaryLength })}
            />
          }
        />
        <Row
          label="Layout"
          for="summary-grouping"
          hint="Grouped suits many channels you skim one by one; one list suits a few related channels."
          control={
            <Select
              id="summary-grouping"
              class={styles.control}
              value={s().grouping}
              options={choiceOptions(GROUPINGS)}
              onChange={(v) => update({ grouping: v as SummaryGrouping })}
            />
          }
        />
        <Row
          label="Range the Summary panel starts on"
          for="summary-default-range"
          control={
            <Select
              id="summary-default-range"
              class={styles.control}
              value={s().defaultRange}
              options={Object.entries(SUMMARY_RANGES).map(([id, r]) => ({ value: id, label: r.label }))}
              onChange={(v) => update({ defaultRange: v as SummaryRange })}
            />
          }
        />
      </Card>
      <Card title="Content">
        <Row
          label="“For you” list"
          for="summary-actions"
          hint="Above the points: questions and requests put to you, deadlines and events, and decisions waiting on your input, each linked to its message. Leaves out anything already answered."
          control={
            <Switch id="summary-actions" checked={s().actionItems} onChange={(on) => update({ actionItems: on })} />
          }
        />
        <Row
          label="What matters to you"
          for="summary-focus"
          hint="Points about these are kept even when minor. Leave empty for a neutral summary."
        >
          <textarea
            id="summary-focus"
            class={styles.wide}
            rows={3}
            maxLength={SUMMARY_FOCUS_MAX_CHARS}
            placeholder="e.g. release dates, anything about billing, what Sam decides"
            value={s().focus}
            onChange={(e) => update({ focus: e.currentTarget.value })}
          />
        </Row>
        <Row
          label="Skip obvious filler"
          for="summary-skip-filler"
          hint="Leaves out messages that are only emoji or links, and short throwaways like “lol”, unless they are replies or contain a number or question. Rules, not AI: free and instant. Only summaries skip them; the archive, search and alerts see every message."
          control={
            <Switch
              id="summary-skip-filler"
              checked={summarySettings().skipObviousFiller}
              onChange={(on) => update({ skipObviousFiller: on })}
            />
          }
        />
      </Card>
    </>
  );
}

/** Summaries on a schedule are rules (#96): listed here, edited in Settings → Rules. */
function AutoBody() {
  const s = summarySettings;
  const scopeSave = createAction();
  return (
    <>
      <Note>
        Rules that summarize on a schedule: at a time of day, every few hours, or when ChattyPop opens after time away.
        Each reads everything, one server or one channel. They use the default AI provider and count toward its plan
        usage, start once sync has caught up, and appear in the Summary panel.
      </Note>
      <Card>
        <For each={scheduledSummaries()}>
          {(r) => (
            <Row
              label={r.name}
              hint={`${r.spec.trigger.type === 'timed' ? timedTriggerText(r.spec.trigger.config as import('@plugin-sdk/shared').TimedTrigger, DAY_NAMES) : ''} · ${r.enabled ? 'on' : 'off'}`}
              control={
                <span class={styles.buttons}>
                  <ScopeSelect class={styles.control} value={ruleScope(r)} onChange={(scope) => void scopeSave.run(() => setRuleScope(r, scope))} />
                  <button type="button" class="cp-button" onClick={() => openRule(r.id)}>
                    Edit…
                  </button>
                </span>
              }
            />
          )}
        </For>
        <Show when={scopeSave.error()}>
          <Note kind="error">{scopeSave.error()}</Note>
        </Show>
        <Row
          label="Add a scheduled summary"
          hint="A new rule: pick “Daily digest” or “Catch me up”, or start it on a time and add Summarize."
          control={
            <button type="button" class="cp-button" onClick={() => startNewRule()}>
              New rule…
            </button>
          }
        />
        <Row
          label="Notify when an automatic summary is ready"
          for="summary-notify"
          hint="A Windows notification with the headline and how many items are for you; also when one fails. Needs Windows notifications on."
          control={
            <Switch id="summary-notify" checked={s().notifyAuto} onChange={(on) => update({ notifyAuto: on })} />
          }
        />
      </Card>
    </>
  );
}

/** Every provider's model cost plus Jev's, in USD. */
const spendTotal = (s: SummarySpend): number => s.providers.reduce((n, p) => n + p.apiCostUsd, 0) + s.jevCostUsd;

/** One provider's line: its cost, runs, tokens, and runs with no cost. */
const providerLine = (p: ProviderSpend): string =>
  [
    `${providerName(p.provider)} ≈${usdText(p.apiCostUsd)}`,
    countText(p.runs, 'summary', 'summaries'),
    `${formatTokens(p.inputTokens)} in (${formatTokens(p.cachedInputTokens)} cached) · ${formatTokens(p.outputTokens)} out`,
    ...(p.unpricedRuns ? [`${p.unpricedRuns} without a cost`] : []),
  ].join(' · ');

/** One window's split: a line per provider, then Jev. */
function SpendBreakdown(props: { spend: SummarySpend }) {
  return (
    <Show when={props.spend.providers.length} fallback="No summaries.">
      <For each={props.spend.providers}>{(p) => <>{providerLine(p)}<br /></>}</For>
      Jev {usdText(props.spend.jevCostUsd)}
    </Show>
  );
}

/** Totals of what each run records (its detail line in the Summary panel), over a few windows. */
function SpendingBody(props: { spending: () => SummarySpend[] }) {
  const spending = () => props.spending();
  return (
    <>
      <Note>
        Each provider's figure is what its summary calls cost, or would cost, at the model's API list rates: real
        charges on OpenRouter, and on a Claude or ChatGPT plan an equivalent, not a bill. Jev is charged to your
        OpenRouter key. Runs from before costs were kept are estimated from their tokens at today's rates, on the low
        side. Runs with a local model or a model without a known price have no cost and are left out. Each model in a comparison counts as a summary.
      </Note>
      <Card>
        <For each={SPEND_PERIODS}>
          {(period, i) => (
            <Row
              label={period.label}
              hint={<Show when={spending()[i()]} fallback="Reading…">{(s) => <SpendBreakdown spend={s()} />}</Show>}
              control={
                <Show when={spending()[i()]}>
                  {(s) => (
                    <span class={look.text} data-size="md" data-weight="semibold" data-tone="primary">
                      ≈{usdText(spendTotal(s()))}
                    </span>
                  )}
                </Show>
              }
            />
          )}
        </For>
      </Card>
    </>
  );
}

/** The owner's prompt templates, and what a run would send with them. */
function PromptsBody() {
  const preview = createPromptPreview();
  return (
    <>
      <Note>
        Edit the wording freely. The placeholders in braces are filled in for each run from the settings above, and{' '}
        {'{refs}'} is required. Rules can use their own prompts. The time is the moment of the run, and key themes are
        left out for channels set to local AI only.
      </Note>
      <SummaryPromptEditor
        idPrefix="summary-prompt"
        templates={summarySettings().prompts}
        inherited={(kind) => DEFAULT_SUMMARY_PROMPTS[kind]}
        resetLabel="Reset to default"
        onChange={(kind, text) => update({ prompts: { ...summarySettings().prompts, [kind]: text } })}
        preview={preview()}
      />
    </>
  );
}
