// Settings → Image text: the engine that reads images, when it reads them, and its queue.
import { For, Show } from 'solid-js';
import { IMAGE_TEXT_TAB } from '../shared';
import { HOSTED_VISION_OFF, type EngineStatus, type ImageTextEngine, type ImageTextSettings } from '../shared/types';
import { imageTextSettings, imageTextStatus, patchImageTextSettings, retryFailedImageText } from './state';
import { Card, createAction, ErrorNote, LinkButton, look, ModelRows, openSettingsAt, Page, Row, SettingsButton, Switch } from '@plugin-sdk/renderer/kit';
import styles from './ImageText.module.css';

const ENGINE_LABEL: Record<ImageTextEngine, string> = { windows: 'Windows OCR (built in)', vision: 'Vision model' };
/** Settings → AI: where a provider installs models (Ollama's "Install a model"). */
const AI_SETTINGS = 'ai';

type AutoField = 'autoAttachments' | 'autoEmbeds' | 'autoLinks';
/** The automatic switches: one per place images come from. */
const AUTO_ROWS: readonly { field: AutoField; label: string }[] = [
  { field: 'autoAttachments', label: 'Read attached images automatically' },
  { field: 'autoEmbeds', label: 'Read link previews’ images automatically' },
  { field: 'autoLinks', label: 'Read fetched posts’ photos automatically' },
];

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
    return c ? (
      <>
        {c.queued + c.fetching} queued · {c.running} reading ·{' '}
        <span class={look.text} data-tone="success">{c.done} done</span> ·{' '}
        <span class={look.text} data-tone="danger">{c.failed} failed</span>
      </>
    ) : (
      'Status unknown'
    );
  };
  return (
    <Page
      id={IMAGE_TEXT_TAB}
      title="Image text"
      lede="Reads the text in screenshots and charts that messages show, so rules, Jev, labels and search see it. Images are read on this computer unless you allow a hosted model."
    >
      <Card title="Queue">
        <Row
          label="Images"
          hint={queueText()}
          control={
            <Show when={(counts()?.failed ?? 0) > 0}>
              <SettingsButton tone="danger" onClick={() => void action.run(retryFailedImageText)}>Retry failed</SettingsButton>
            </Show>
          }
        />
      </Card>
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
          <Row
            label="Send images to hosted AI"
            for="imagetext-hosted-vision"
            hint="Lets hosted AI providers’ models read images; the images then leave this computer. Channels set to local AI only never send theirs. Off: only local models are offered."
            control={<Switch id="imagetext-hosted-vision" checked={s().hostedVision} onChange={(hostedVision) => patchImageTextSettings({ hostedVision })} />}
          />
          <ModelRows
            id="imagetext-vision"
            providers={imageTextStatus()?.providers ?? []}
            providerId={s().visionProvider}
            modelId={s().visionModel}
            onChange={(visionProvider, visionModel) => patchImageTextSettings({ visionProvider, visionModel })}
            none="None of the AI providers reads images."
            kind="that reads images"
            fixedHere={(why) => why === HOSTED_VISION_OFF}
            modelHint={
              <>
                An instruct model reads an image in seconds; a thinking one (qwen3-vl:8b) takes up to a minute.{' '}
                <LinkButton onClick={() => openSettingsAt(AI_SETTINGS)}>Install another</LinkButton>
              </>
            }
          />
        </Show>
      </Card>
      <Card title="Reading">
        <For each={AUTO_ROWS}>
          {(r) => (
            <Row
              label={r.label}
              for={`imagetext-${r.field}`}
              hint="New messages’, and those of messages from the last day that Jev still judges. Others: right-click a message → Read image text."
              control={<Switch id={`imagetext-${r.field}`} checked={s()[r.field]} onChange={(on) => patchImageTextSettings({ [r.field]: on } as Partial<ImageTextSettings>)} />}
            />
          )}
        </For>
        <Row
          label="Ask Jev again when image text arrives"
          for="imagetext-ask-jev"
          hint="Off: only rules and settled labels (a $TICKER’s Trading label) use the text. On: Jev judges the message again, which costs a Jev request."
          control={<Switch id="imagetext-ask-jev" checked={s().askJev} onChange={(askJev) => patchImageTextSettings({ askJev })} />}
        />
      </Card>
      <ErrorNote error={action.error()} />
    </Page>
  );
}

