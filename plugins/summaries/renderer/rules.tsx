// Summary rule fields and collapsed-card wording.
import { Show } from 'solid-js';
import { ACTION_LOOKBACKS } from '@plugin-sdk/shared';
import type { KindProps, KindView } from '@plugin-sdk/renderer';
import { RuleLookback as Lookback, Switch, Row } from '@plugin-sdk/renderer/kit';
import { DEFAULT_SUMMARY_PROMPTS, NO_PROMPT_OVERRIDES } from '../shared/prompts';
import type { SummarizeConfig } from '../shared/rules';
import { summarySettings } from './settings';
import { createPromptPreview } from './state';
import { SummaryPromptEditor } from './SummaryPromptEditor';

function SummaryEditor(props: KindProps<SummarizeConfig>) {
  const id = (field: string) => `${props.id}-${field}`;
  return (
    <>
      <Lookback {...props} />
      <OwnPrompts id={id('prompt')} config={props.config} onChange={props.onChange} />
    </>
  );
}
/** A summarize action's own prompts (absent = the ones in Settings → Summaries). */
/** A summarize action’s own prompts; absent means the ones in Settings → Summaries. */
function OwnPrompts(props: KindProps<SummarizeConfig>) {
  const preview = createPromptPreview(() => props.config.prompts);
  return (
    <Row
      label="Own prompt"
      for={props.id}
      hint="Off: uses the prompts in Settings → Summaries. On: this rule's summaries use their own; a part left as it is follows Settings."
      control={
        <Switch
          id={props.id}
          checked={!!props.config.prompts}
          onChange={(on) => props.onChange({ ...props.config, prompts: on ? NO_PROMPT_OVERRIDES : undefined })}
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
            onChange={(kind, text) => props.onChange({ ...props.config, prompts: { ...own(), [kind]: text } })}
            preview={preview()}
          />
        )}
      </Show>
    </Row>
  );
}

/** Summarize fields for message lookbacks and timed windows. */
export const summaryView: KindView<SummarizeConfig> = {
  windowHint: "Summarizes the rule's channels over the time it covers. Uses your AI plan.",
  Editor: SummaryEditor,
  summary: (config, cover) => cover ?? ACTION_LOOKBACKS.find((item) => item.ms === config.lookbackMs)?.label ?? '',
};
