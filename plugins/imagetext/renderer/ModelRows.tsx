// Settings → Image text and → Translation: a provider and one of its models, for the vision engine or for translation.
import { Show, type JSX } from 'solid-js';
import type { ProviderModels } from '../shared/types';
import { LinkButton, Note, openSettingsAt, Row, Select } from '@plugin-sdk/renderer/kit';
import styles from './ImageText.module.css';

/** Settings → AI: where a provider is turned on and installs models (Ollama's "Install a model"). */
export const AI_SETTINGS = 'ai';
/** The select's choice while none (or one no longer listed) is saved. */
const NONE = '';

export interface ModelRowsProps {
  /** Element ids' prefix: one set per picker on the page. */
  id: string;
  providers: ProviderModels[];
  providerId: string | null;
  modelId: string | null;
  /** A new provider starts with no model picked: models belong to a provider. */
  onChange(providerId: string | null, modelId: string | null): void;
  /** Shown when no provider offers this kind of model. */
  none: string;
  /** Which of its models count, when not all ("that reads images"). */
  kind?: string;
  modelHint?: JSX.Element;
}

/** A provider row, then its model row: picks of what's listed, the saved choice kept only while still listed. */
export function ModelRows(props: ModelRowsProps) {
  const provider = (): ProviderModels | undefined => props.providers.find((p) => p.id === props.providerId);
  const models = () => provider()?.models ?? [];
  const providerOptions = () => [
    ...(provider() ? [] : [{ value: NONE, label: 'Pick a provider…' }]),
    ...props.providers.map((p) => ({ value: p.id, label: p.unavailable ? `${p.label} (${p.unavailable})` : p.label })),
  ];
  const modelValue = (): string => (models().some((m) => m.id === props.modelId) ? (props.modelId ?? NONE) : NONE);
  const modelOptions = () => [...(modelValue() === NONE ? [{ value: NONE, label: 'Pick a model…' }] : []), ...models().map((m) => ({ value: m.id, label: m.label }))];
  return (
    <>
      <Show when={props.providers.length} fallback={<Note>{props.none}</Note>}>
        <Row
          label="Provider"
          for={`${props.id}-provider`}
          control={<Select id={`${props.id}-provider`} class={styles.control} value={provider()?.id ?? NONE} options={providerOptions()} onChange={(v) => props.onChange(v || null, null)} />}
        />
      </Show>
      <Show when={provider()}>
        {(p) => (
          <Show
            when={models().length}
            fallback={
              // Can't run (turned off, unreachable): why, and where to fix it. Runs: none of its models fit.
              <Show
                when={p().unavailable}
                fallback={
                  <Note>
                    No model on {p().label}{props.kind ? ` ${props.kind}` : ''} is installed. <LinkButton onClick={() => openSettingsAt(AI_SETTINGS)}>Install one in Settings → AI</LinkButton>
                  </Note>
                }
              >
                {(why) => (
                  <Note>
                    {p().label} can’t be used: {why()} <LinkButton onClick={() => openSettingsAt(AI_SETTINGS)}>Open Settings → AI</LinkButton>
                  </Note>
                )}
              </Show>
            }
          >
            <Row
              label="Model"
              for={`${props.id}-model`}
              hint={props.modelHint}
              control={<Select id={`${props.id}-model`} class={styles.control} value={modelValue()} options={modelOptions()} onChange={(v) => props.onChange(p().id, v || null)} />}
            />
          </Show>
        )}
      </Show>
    </>
  );
}
