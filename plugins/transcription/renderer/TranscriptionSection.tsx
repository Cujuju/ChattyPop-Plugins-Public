import { For, Show, type JSX } from 'solid-js';
import { AUTO_KINDS, type AutoKind, type InstallItem, type ModelScore, type ToolBuild } from '../shared/types';
import {
  cancelTranscriptionItem,
  deleteTranscriptionModel,
  installTranscriptionItem,
  recheckTranscription,
  patchTranscriptionSettings,
  setAuto,
  transcriptionSettings,
  transcriptionStatus,
} from './state';
import {
  Card,
  createAction,
  ErrorNote,
  formatBytes,
  look,
  Note,
  percentText,
  Row,
  SectionsPage,
  SettingsButton,
  Switch,
} from '@plugin-sdk/renderer/kit';
import styles from './Transcription.module.css';

const BUILD_LABEL: Record<ToolBuild, string> = { gpu: 'GPU build', cpu: 'CPU build' };

/** Overview's automatic switches: each kind's label and what it covers. */
const AUTO_ROWS: Record<AutoKind, { label: string; hint: string }> = {
  voice: { label: 'Voice messages', hint: "Discord's recorded voice messages." },
  audio: { label: 'Audio files', hint: 'Other sound files posted as attachments.' },
  video: { label: 'Video files', hint: 'Videos posted as attachments; their sound is transcribed.' },
  embedVideo: { label: 'Videos in link previews', hint: "A linked post's video, fetched through Discord." },
};

/** A model's measured accuracy, and its speed on the whisper.cpp build in use. */
function scoreText(s: ModelScore, build: ToolBuild): string {
  return `Accuracy ${s.accuracy}% · ${s.speed[build]}× real time (${BUILD_LABEL[build]})`;
}

/** What an item's state reads as; tools also say where the program came from and which build it is. */
function stateText(item: InstallItem): string {
  switch (item.state) {
    case 'downloading':
      return `Downloading… ${percentText(item.progress ?? 0)}`;
    case 'installing':
      return 'Installing…';
    case 'failed':
      return 'Failed';
    case 'ready':
      if (item.source === 'path') return 'Found on this computer';
      return item.builds.length > 1 && item.build ? `Installed (${BUILD_LABEL[item.build]})` : 'Installed';
    case 'missing':
      return 'Not installed';
  }
}

/** Install, cancel and delete requests; the latest one's error shows on every page of this section. */
const request = createAction();
const error = request.error;
const act = (p: Promise<void>): void => void request.run(() => p);

/** Settings → Transcription: local speech-to-text for voice messages, and the programs and models it downloads. */
export function TranscriptionSection() {
  const status = transcriptionStatus;
  const readyCount = (items: InstallItem[] | undefined): string => `${(items ?? []).filter((i) => i.state === 'ready').length} of ${(items ?? []).length} ready`;
  const modelLabel = () => status()?.models.find((m) => m.id === transcriptionSettings().model)?.label ?? 'none picked';
  return (
    <SectionsPage
      id="transcription"
      title="Transcription"
      lede="Voice messages, audio and video are turned into text on this computer (whisper.cpp), so they show up in search, rules and summaries. Their sound never leaves your machine."
      sections={[
        { id: 'overview', label: 'Overview', meta: () => `${status()?.ready ? 'Ready' : 'Not set up'} · ${AUTO_KINDS.some((k) => transcriptionSettings().auto[k]) ? 'automatic' : 'on request'}`, body: OverviewBody },
        { id: 'programs', label: 'Programs', meta: () => readyCount(status()?.tools), body: ProgramsBody },
        { id: 'models', label: 'Models', meta: () => `Using ${modelLabel()}`, body: ModelsBody },
      ]}
    />
  );
}

function OverviewBody() {
  const status = transcriptionStatus;
  return (
    <>
      <Card>
        <Row label="Status" hint={status()?.ready ? 'Ready.' : 'Not set up: install both programs and a model, then pick the model to use.'} />
      </Card>
      <Card title="Transcribe new ones automatically">
        <For each={AUTO_KINDS}>
          {(kind) => (
            <Row
              label={AUTO_ROWS[kind].label}
              for={`transcribe-auto-${kind}`}
              hint={AUTO_ROWS[kind].hint}
              control={<Switch id={`transcribe-auto-${kind}`} checked={transcriptionSettings().auto[kind]} onChange={(on) => setAuto(kind, on)} />}
            />
          )}
        </For>
      </Card>
      <Note>Anything older, or switched off here: right-click its message in the Archive → Transcribe.</Note>
      <Note>
        The only network use is downloading the programs and models, from GitHub and Hugging Face, each checked against a pinned checksum.
      </Note>
      <ErrorNote error={error()} />

    </>
  );
}

function ProgramsBody() {
  const status = transcriptionStatus;
  return (
    <>
      <Note>
        {status()?.gpu
          ? 'NVIDIA GPU found: the GPU build of whisper.cpp is much faster. If transcripts fail with a CUDA error, switch to the CPU build.'
          : 'No NVIDIA GPU found: the CPU build of whisper.cpp is recommended.'}
      </Note>
      <Card title="Programs" meta={<SettingsButton onClick={() => recheckTranscription()}>Check again</SettingsButton>}>
        <For each={status()?.tools ?? []}>
          {(t) => (
            <Item item={t}>
              <Show when={t.state === 'missing' || t.state === 'failed'}>
                <Show when={status()?.canInstallTools} fallback={<span class={look.text} data-size="xs" data-tone="muted">Install it with your package manager so it is on PATH.</span>}>
                  <For each={t.builds}>
                    {(b) => (
                      <SettingsButton onClick={() => act(installTranscriptionItem(t.id, b.build))}>
                        Install{t.builds.length > 1 ? ` ${BUILD_LABEL[b.build]}` : ''} ({formatBytes(b.bytes)})
                      </SettingsButton>
                    )}
                  </For>
                </Show>
              </Show>
              <Show when={t.state === 'ready' && t.source === 'app' && t.builds.length > 1}>
                <For each={t.builds.filter((b) => b.build !== t.build)}>
                  {(b) => (
                    <SettingsButton onClick={() => act(installTranscriptionItem(t.id, b.build))}>
                      Switch to {BUILD_LABEL[b.build]} ({formatBytes(b.bytes)})
                    </SettingsButton>
                  )}
                </For>
              </Show>
              <Show when={t.state === 'downloading'}>
                <SettingsButton onClick={() => act(cancelTranscriptionItem(t.id))}>
                  Cancel
                </SettingsButton>
              </Show>
            </Item>
          )}
        </For>
      </Card>
      <ErrorNote error={error()} />

    </>
  );
}

function ModelsBody() {
  const status = transcriptionStatus;
  /** Speeds shown are for the installed whisper.cpp build, else the recommended one. */
  const speedBuild = (): ToolBuild => status()?.tools.find((t) => t.id === 'whisper-cli')?.build ?? (status()?.gpu ? 'gpu' : 'cpu');
  return (
    <>
      <Note>
        Accuracy is the share of words transcribed right, over conversation and read speech. Speed is seconds of voice message transcribed per second, measured on an RTX
        3090 and a Ryzen 9 5950X; other computers differ. Every model detects the language itself.
      </Note>
      <Card title="Models">
        <div role="radiogroup" aria-label="Model to use">
          <For each={status()?.models ?? []}>
            {(m) => (
              <Item item={m} detail={m.score ? scoreText(m.score, speedBuild()) : null}>
                <label class={`${styles.defaultPick} ${look.toggleLabel} ${look.text}`} data-size="xs" data-tone="muted" data-font="sans">
                  <input
                    type="radio"
                    name="transcription-model"
                    checked={transcriptionSettings().model === m.id}
                    disabled={m.state !== 'ready'}
                    onChange={() => patchTranscriptionSettings({ model: m.id })}
                  />
                  Use
                </label>
                <Show when={m.state === 'missing' || m.state === 'failed'}>
                  <SettingsButton onClick={() => act(installTranscriptionItem(m.id))}>
                    Download ({formatBytes(m.bytes)})
                  </SettingsButton>
                </Show>
                <Show when={m.state === 'downloading'}>
                  <SettingsButton onClick={() => act(cancelTranscriptionItem(m.id))}>
                    Cancel
                  </SettingsButton>
                </Show>
                <Show when={m.state === 'ready'}>
                  <SettingsButton onClick={() => act(deleteTranscriptionModel(m.id))}>
                    Delete
                  </SettingsButton>
                </Show>
              </Item>
            )}
          </For>
        </div>
      </Card>
      <ErrorNote error={error()} />

    </>
  );
}

/** One program or model as a row: name, what it is and its state, its error, and its actions on the right. */
function Item(props: { item: InstallItem; detail?: string | null; children: JSX.Element }) {
  return (
    <Row label={props.item.label} hint={[props.item.description, stateText(props.item), props.detail].filter(Boolean).join(' · ')} control={props.children}>
      <ErrorNote error={props.item.error} />

    </Row>
  );
}
