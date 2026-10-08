// Summary rule fields and collapsed-card wording: the manual run's choices, each following Settings until set.
import { Show } from 'solid-js';
import { ACTION_LOOKBACKS } from '@plugin-sdk/shared';
import type { KindProps, KindView } from '@plugin-sdk/renderer';
import { ProviderSelect, RuleLookback as Lookback, Row, Select, Switch, choiceOptions, providerLabel } from '@plugin-sdk/renderer/kit';
import { DEFAULT_SUMMARY_PROMPTS, NO_PROMPT_OVERRIDES } from '../shared/prompts';
import { RULE_SUMMARY_RANGES, type RuleSummaryRange, type SummarizeConfig } from '../shared/rules';
import { SUMMARY_FOCUS_MAX_CHARS, SUMMARY_RANGES, type SummaryGrouping, type SummaryLength } from '../shared/settings';
import { summarySettings } from './settings';
import { createPromptPreview } from './state';
import { SummaryPromptEditor } from './SummaryPromptEditor';
import { ACTION_ITEMS_HINT, FILLER_HINT, FOCUS_HINT, FOCUS_PLACEHOLDER, GROUPINGS, LAYOUT_HINT, LENGTH_LABEL, LENGTH_OPTIONS, lengthHint } from './styleText';
import styles from './Summary.module.css';

/** A select's value for an option left to Settings → Summaries. */
const FOLLOW = '';
const asInSettings = (current: string): string => `As in Settings (${current})`;
const ON = 'on';
const OFF = 'off';
const onOff = (on: boolean): string => (on ? 'On' : 'Off');
const RANGE_OPTIONS = RULE_SUMMARY_RANGES.map((r) => ({ value: r, label: SUMMARY_RANGES[r].label }));

type Props = KindProps<SummarizeConfig>;
/** Sets or clears (undefined) the rule's options. */
const patch = (props: Props, p: Partial<SummarizeConfig>): void => props.onChange({ ...props.config, ...p });

function SummaryEditor(props: Props) {
  const id = (field: string) => `${props.id}-${field}`;
  const s = summarySettings;
  const set = (p: Partial<SummarizeConfig>): void => patch(props, p);
  const length = (): SummaryLength => props.config.length ?? s().length;
  return (
    <>
      <Show when={props.cover} fallback={<Lookback {...props} />}>
        {(cover) => (
          <Row
            label="Time frame"
            for={id('range')}
            hint="Ends when it runs; Yesterday is the whole local day before."
            control={
              <Select
                id={id('range')}
                class={styles.control}
                value={props.config.range ?? FOLLOW}
                options={[{ value: FOLLOW, label: cover() }, ...RANGE_OPTIONS]}
                onChange={(v) => set({ range: (v || undefined) as RuleSummaryRange | undefined })}
              />
            }
          />
        )}
      </Show>
      <Row
        label="Provider"
        for={id('provider')}
        hint="With the model and effort Settings → AI providers picks for it."
        control={
          <ProviderSelect
            id={id('provider')}
            class={styles.control}
            unsetLabel={asInSettings(s().defaultProvider ? providerLabel(s().defaultProvider!) : 'none chosen')}
            value={props.config.provider ?? null}
            onChange={(p) => set({ provider: p ?? undefined })}
          />
        }
      />
      <Row
        label="Length"
        for={id('length')}
        hint={lengthHint(length())}
        control={
          <Select
            id={id('length')}
            class={styles.control}
            value={props.config.length ?? FOLLOW}
            options={[{ value: FOLLOW, label: asInSettings(LENGTH_LABEL[s().length]) }, ...LENGTH_OPTIONS]}
            onChange={(v) => set({ length: (v || undefined) as SummaryLength | undefined })}
          />
        }
      />
      <Row
        label="Layout"
        for={id('grouping')}
        hint={LAYOUT_HINT}
        control={
          <Select
            id={id('grouping')}
            class={styles.control}
            value={props.config.grouping ?? FOLLOW}
            options={[{ value: FOLLOW, label: asInSettings(GROUPINGS[s().grouping].meta) }, ...choiceOptions(GROUPINGS)]}
            onChange={(v) => set({ grouping: (v || undefined) as SummaryGrouping | undefined })}
          />
        }
      />
      <OnOffRow id={id('actions')} label="“For you” list" hint={ACTION_ITEMS_HINT} value={props.config.actionItems} inherited={s().actionItems} onChange={(actionItems) => set({ actionItems })} />
      <Row
        label="What matters to you"
        for={id('focus')}
        hint={FOCUS_HINT}
        control={
          <Select
            id={id('focus')}
            class={styles.control}
            value={props.config.focus === undefined ? FOLLOW : ON}
            options={[
              { value: FOLLOW, label: asInSettings(s().focus ? 'set' : 'none') },
              { value: ON, label: 'Its own' },
            ]}
            onChange={(v) => set({ focus: v ? s().focus : undefined })}
          />
        }
      >
        <Show when={props.config.focus !== undefined}>
          <textarea
            id={id('focus-text')}
            aria-label="What matters to this rule"
            class={styles.wide}
            rows={3}
            maxLength={SUMMARY_FOCUS_MAX_CHARS}
            placeholder={FOCUS_PLACEHOLDER}
            value={props.config.focus ?? ''}
            onInput={(e) => set({ focus: e.currentTarget.value })}
          />
        </Show>
      </Row>
      <OnOffRow id={id('filler')} label="Skip obvious filler" hint={FILLER_HINT} value={props.config.skipObviousFiller} inherited={s().skipObviousFiller} onChange={(skipObviousFiller) => set({ skipObviousFiller })} />
      <OwnPrompts id={id('prompt')} config={props.config} onChange={props.onChange} />
    </>
  );
}

/** A switch-like option as a select: following Settings, on or off. */
function OnOffRow(props: { id: string; label: string; hint: string; value: boolean | undefined; inherited: boolean; onChange: (v: boolean | undefined) => void }) {
  return (
    <Row
      label={props.label}
      for={props.id}
      hint={props.hint}
      control={
        <Select
          id={props.id}
          class={styles.control}
          value={props.value === undefined ? FOLLOW : props.value ? ON : OFF}
          options={[
            { value: FOLLOW, label: asInSettings(onOff(props.inherited).toLowerCase()) },
            { value: ON, label: onOff(true) },
            { value: OFF, label: onOff(false) },
          ]}
          onChange={(v) => props.onChange(v ? v === ON : undefined)}
        />
      }
    />
  );
}

/** A summarize action's own prompts; absent means the ones in Settings → Summaries. The preview fills them with the rule's options. */
function OwnPrompts(props: Props) {
  const preview = createPromptPreview(() => {
    const { lookbackMs: _, range: __, ...own } = props.config;
    return own;
  });
  return (
    <Row
      label="Own prompt"
      for={props.id}
      hint="Off: uses the prompts in Settings → Summaries. On: this rule's summaries use their own; a part left as it is follows Settings."
      control={
        <Switch
          id={props.id}
          checked={!!props.config.prompts}
          onChange={(on) => patch(props, { prompts: on ? NO_PROMPT_OVERRIDES : undefined })}
        />
      }
    >
      <Show when={props.config.prompts}>
        {(own) => (
          <SummaryPromptEditor
            idPrefix={props.id}
            templates={own()}
            inherited={(kind) => summarySettings().prompts[kind] ?? DEFAULT_SUMMARY_PROMPTS[kind]}
            resetLabel="Use the Settings prompt"
            onChange={(kind, text) => patch(props, { prompts: { ...own(), [kind]: text } })}
            preview={preview()}
          />
        )}
      </Show>
    </Row>
  );
}

/** The time read, then each option the rule sets itself. */
function summaryLine(c: SummarizeConfig, cover?: string): string {
  const time = c.range ? SUMMARY_RANGES[c.range].label : (cover ?? ACTION_LOOKBACKS.find((item) => item.ms === c.lookbackMs)?.label ?? '');
  const own = [
    c.provider && providerLabel(c.provider),
    c.length && LENGTH_LABEL[c.length].toLowerCase(),
    c.grouping && GROUPINGS[c.grouping].meta,
    c.actionItems !== undefined && `“For you” ${onOff(c.actionItems).toLowerCase()}`,
    c.focus !== undefined && 'own focus',
    c.skipObviousFiller !== undefined && (c.skipObviousFiller ? 'skips filler' : 'keeps filler'),
    c.prompts && 'own prompt',
  ];
  return [time, ...own.filter(Boolean)].join(' · ');
}

/** Summarize fields for message lookbacks and timed windows. */
export const summaryView: KindView<SummarizeConfig> = {
  windowHint: "Summarizes the rule's channels over the time it covers. Uses your AI plan.",
  Editor: SummaryEditor,
  summary: summaryLine,
};
