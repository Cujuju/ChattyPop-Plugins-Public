// Editable summary prompts and preview.
import { For, Show, createSignal } from 'solid-js';
import type { SummaryPrompts } from '../shared/types';
import { SUMMARY_PROMPT_KINDS, SUMMARY_PROMPT_PLACEHOLDERS, summaryPromptError, type SummaryPromptKind, type SummaryPromptTemplates } from '../shared/prompts';
import { Card, ErrorNote, Row } from '@plugin-sdk/renderer/kit';
import styles from './Summary.module.css';

const KIND_TEXT: Record<SummaryPromptKind, { title: string; hint: string }> = {
  summarize: {
    title: 'Summarize',
    hint: 'Sent with the messages, one per line with its ref (like m12), channel, time and author. A long range is split into parts, each sent with this.',
  },
  merge: { title: 'Merge', hint: 'Only when a range was split: sent with each part’s summary to combine them into one.' },
};

const lines = (text: string): number => text.split('\n').length;

/**
 * Edits summary prompt templates (Settings → Summaries, a rule's own prompt). `inherited` is what a kind uses while
 * its template is null; saving text equal to it stores null. `preview` is the filled prompts as a run would send them.
 */
export function SummaryPromptEditor(props: {
  idPrefix: string;
  templates: SummaryPromptTemplates;
  inherited: (kind: SummaryPromptKind) => string;
  resetLabel: string;
  onChange: (kind: SummaryPromptKind, text: string | null) => void;
  preview: SummaryPrompts | null | undefined;
}) {
  return (
    <>
      <For each={SUMMARY_PROMPT_KINDS}>
        {(kind) => (
          <TemplateField
            id={`${props.idPrefix}-${kind}`}
            kind={kind}
            text={props.templates[kind] ?? props.inherited(kind)}
            customized={props.templates[kind] !== null}
            resetLabel={props.resetLabel}
            onSave={(text) => props.onChange(kind, text === props.inherited(kind) ? null : text)}
            onReset={() => props.onChange(kind, null)}
          />
        )}
      </For>
      <Card title="Placeholders">
        <For each={Object.entries(SUMMARY_PROMPT_PLACEHOLDERS)}>{([name, what]) => <Row label={`{${name}}`} hint={what} />}</For>
      </Card>
      <Show when={props.preview}>
        {(p) => (
          <Card title="As sent now">
            <For each={SUMMARY_PROMPT_KINDS}>
              {(kind) => (
                <Row label={KIND_TEXT[kind].title} for={`${props.idPrefix}-${kind}-sent`}>
                  <textarea id={`${props.idPrefix}-${kind}-sent`} class={styles.wide} readOnly rows={lines(p()[kind])} value={p()[kind]} />
                </Row>
              )}
            </For>
          </Card>
        )}
      </Show>
    </>
  );
}

/** One template; saved on leaving the field, and kept unsaved (with the reason) while it can't be used. */
function TemplateField(props: {
  id: string;
  kind: SummaryPromptKind;
  text: string;
  customized: boolean;
  resetLabel: string;
  onSave: (text: string) => void;
  onReset: () => void;
}) {
  const [error, setError] = createSignal<string | null>(null);
  let area!: HTMLTextAreaElement;
  const save = (text: string): void => {
    const err = summaryPromptError(text);
    setError(err);
    if (!err) props.onSave(text);
  };
  const reset = (): void => {
    setError(null);
    props.onReset();
    area.value = props.text; // the stored value may not change (an unsaved invalid edit), so the field is reset directly
  };
  return (
    <Card title={KIND_TEXT[props.kind].title}>
      <Row
        label="Template"
        for={props.id}
        hint={KIND_TEXT[props.kind].hint}
        control={
          <Show when={props.customized || error()}>
            <button type="button" class="cp-button" onClick={reset}>
              {props.resetLabel}
            </button>
          </Show>
        }
      >
        <textarea ref={area} id={props.id} class={styles.wide} rows={lines(props.text)} value={props.text} onChange={(e) => save(e.currentTarget.value)} />
        <ErrorNote error={error()} />
      </Row>
    </Card>
  );
}
