// Settings → Image text and → Translation: a provider, then its models as Settings → AI lists them, one picked.
import { Show, type JSX } from 'solid-js';
import { HOSTED_VISION_OFF, type ProviderModels } from '../shared/types';
import { LinkButton, ModelList, Note, openSettingsAt, Row, Select } from '@plugin-sdk/renderer/kit';
import styles from './ImageText.module.css';

/** Settings → AI: where a provider is turned on and installs models (Ollama's "Install a model"). */
export const AI_SETTINGS = 'ai';
/** The provider select's choice while none is saved. */
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

/** A provider row, then why it can't be used or its models: each with what it can do, one picked. */
export function ModelRows(props: ModelRowsProps) {
  const provider = (): ProviderModels | undefined => props.providers.find((p) => p.id === props.providerId);
  const providerOptions = () => [
    ...(provider() ? [] : [{ value: NONE, label: 'Pick a provider…' }]),
    ...props.providers.map((p) => ({ value: p.id, label: p.unavailable ? `${p.label} (can’t be used)` : p.label })),
  ];
  const settingsAi = () => <LinkButton onClick={() => openSettingsAt(AI_SETTINGS)}>Open Settings → AI</LinkButton>;
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
          <>
            {/* Turned off or unreachable: Settings → AI fixes it; hosted vision off: the switch on this page does. */}
            <Show when={p().unavailable}>
              {(why) => (
                <Note>
                  {p().label} can’t be used: {why()} {why() === HOSTED_VISION_OFF ? null : settingsAi()}
                </Note>
              )}
            </Show>
            <Show
              when={p().models.length}
              fallback={
                <Show when={!p().unavailable}>
                  <Note>
                    No model on {p().label}
                    {props.kind ? ` ${props.kind}` : ''} is installed. <LinkButton onClick={() => openSettingsAt(AI_SETTINGS)}>Install one in Settings → AI</LinkButton>
                  </Note>
                </Show>
              }
            >
              <ModelList name={`${props.id}-model`} models={p().models} value={props.modelId} unset="none" onChange={(model) => props.onChange(p().id, model)} />
              <Show when={props.modelHint}>
                <Note>{props.modelHint}</Note>
              </Show>
            </Show>
          </>
        )}
      </Show>
    </>
  );
}
