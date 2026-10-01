// Settings → Image text: the engine that reads images, when it reads them, and its queue.
import { For, Show } from 'solid-js';
import { IMAGE_TEXT_TAB } from '../shared';
import type { EngineStatus, ImageTextEngine, VisionProvider } from '../shared/types';
import { imageTextSettings, imageTextStatus, patchImageTextSettings, retryFailedImageText } from './state';
import { Card, createAction, ErrorNote, LinkButton, look, Note, openSettingsAt, Page, Row, Select, SettingsButton, Switch } from '@plugin-sdk/renderer/kit';
import styles from './ImageText.module.css';

const ENGINE_LABEL: Record<ImageTextEngine, string> = { windows: 'Windows OCR (built in)', vision: 'Vision model' };
/** Settings → AI: where a provider installs models (Ollama's "Install a model"). */
const AI_SETTINGS = 'ai';
/** The select's choice while none (or one no longer listed) is saved. */
const NONE = '';

/** An engine's state and its one-line detail; unknown while status hasn't loaded. */
const engineHint = (s: EngineStatus | undefined): string => (s ? `${s.ready ? 'Ready' : 'Can’t run'} · ${s.detail}` : 'Status unknown');

/** Settings → Image text: reads screenshots and charts on this computer, so rules, Jev, labels and search see their text. */
export function ImageTextSection() {
  const action = createAction();
  const s = imageTextSettings;
  const counts = () => imageTextStatus()?.counts;
  // Fetching (main downloading the image) is still waiting to be read.
  const queueText = () => {
    const c = counts();
    return c ? `${c.queued + c.fetching} queued · ${c.running} reading · ${c.done} done · ${c.failed} failed` : 'Status unknown';
  };
  return (
    <Page
      id={IMAGE_TEXT_TAB}
      title="Image text"
      lede="Reads the text in screenshots and charts that messages show, so rules, Jev, labels and search see it. Images are read on this computer."
    >
      <Card title="Engine">
        <div role="radiogroup" aria-label="Engine">
          <For each={Object.keys(ENGINE_LABEL) as ImageTextEngine[]}>
            {(engine) => (
              <Row
                label={ENGINE_LABEL[engine]}
                hint={engineHint(imageTextStatus()?.[engine])}
                control={
                  <label class={`${styles.pick} ${look.toggleLabel} ${look.text}`} data-size="xs" data-tone="muted" data-font="sans">
                    <input type="radio" name="imagetext-engine" checked={s().engine === engine} onChange={() => patchImageTextSettings({ engine })} />
                    Use
                  </label>
                }
              />
            )}
          </For>
        </div>
        <Show when={s().engine === 'vision'}>
          <VisionRows />
        </Show>
      </Card>
      <Card title="Reading">
        <Row
          label="Read images automatically"
          for="imagetext-auto"
          hint="New messages’ images, and those of messages from the last day that Jev still judges. Others: right-click a message → Read image text."
          control={<Switch id="imagetext-auto" checked={s().auto} onChange={(auto) => patchImageTextSettings({ auto })} />}
        />
        <Row
          label="Ask Jev again when image text arrives"
          for="imagetext-ask-jev"
          hint="Off: only rules and settled labels (a $TICKER’s Trading label) use the text. On: Jev judges the message again, which costs a Jev request."
          control={<Switch id="imagetext-ask-jev" checked={s().askJev} onChange={(askJev) => patchImageTextSettings({ askJev })} />}
        />
      </Card>
      <Card title="Queue">
        <Row
          label="Images"
          hint={queueText()}
          control={
            <Show when={(counts()?.failed ?? 0) > 0}>
              <SettingsButton onClick={() => void action.run(retryFailedImageText)}>Retry failed</SettingsButton>
            </Show>
          }
        />
      </Card>
      <ErrorNote error={action.error()} />
    </Page>
  );
}

/** The vision engine's provider and model. */
function VisionRows() {
  const s = imageTextSettings;
  const providers = (): VisionProvider[] => imageTextStatus()?.providers ?? [];
  const provider = (): VisionProvider | undefined => providers().find((p) => p.id === s().visionProvider);
  const models = () => provider()?.models ?? [];
  const providerOptions = () => [
    ...(provider() ? [] : [{ value: NONE, label: 'Pick a provider…' }]),
    ...providers().map((p) => ({ value: p.id, label: p.unavailable ? `${p.label} (${p.unavailable})` : p.label })),
  ];
  const modelValue = (): string => (models().some((m) => m.id === s().visionModel) ? (s().visionModel ?? NONE) : NONE);
  const modelOptions = () => [...(modelValue() === NONE ? [{ value: NONE, label: 'Pick a model…' }] : []), ...models().map((m) => ({ value: m.id, label: m.label }))];
  return (
    <>
      <Show when={providers().length} fallback={<Note>None of the AI providers reads images.</Note>}>
        <Row
          label="Provider"
          for="imagetext-provider"
          hint={provider()?.unavailable ?? undefined}
          control={
            <Select
              id="imagetext-provider"
              class={styles.control}
              value={provider()?.id ?? NONE}
              options={providerOptions()}
              // Models belong to a provider: a new provider starts with none picked.
              onChange={(v) => patchImageTextSettings({ visionProvider: v || null, visionModel: null })}
            />
          }
        />
      </Show>
      <Show when={provider()}>
        {(p) => (
          <Show
            when={models().length}
            fallback={
              <Note>
                No model on {p().label} that reads images is installed.{' '}
                <LinkButton onClick={() => openSettingsAt(AI_SETTINGS)}>Install one in Settings → AI</LinkButton>
              </Note>
            }
          >
            <Row
              label="Model"
              for="imagetext-model"
              hint={
                <>
                  An instruct model reads an image in seconds; a thinking one (qwen3-vl:8b) takes up to a minute.{' '}
                  <LinkButton onClick={() => openSettingsAt(AI_SETTINGS)}>Install another</LinkButton>
                </>
              }
              control={<Select id="imagetext-model" class={styles.control} value={modelValue()} options={modelOptions()} onChange={(v) => patchImageTextSettings({ visionModel: v || null })} />}
            />
          </Show>
        )}
      </Show>
    </>
  );
}
