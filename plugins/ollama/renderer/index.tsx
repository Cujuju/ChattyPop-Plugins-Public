// Ollama's renderer side: its rows in Settings → AI (address, unload time, installing models).
import { For, createSignal } from 'solid-js';
import { defineRendererPlugin, coreClient, onEvent, pluginPreference, pluginResource } from '@plugin-sdk/renderer';
import { createAction, ErrorNote, formatBytes, percentText, Row, Select, SettingsButton, refetchProviderStatus } from '@plugin-sdk/renderer/kit';
import styles from './Ollama.module.css';
import { INSTALLED_EVENT, PULLS_EVENT, plugin } from '../shared';
import { UNLOAD_AFTER_CHOICES } from '../shared/settings';
import { SUGGESTED_VISION_MODEL, type OllamaPull } from '../shared/types';

const [settings, setSettings, { patch }] = pluginPreference(plugin, 'settings');
const core = coreClient(plugin);
/** Model deletes from Settings → AI's list: one at a time, the latest one's error shown. */
const deletes = createAction();
const pulls = pluginResource(plugin, 'pulls', () => [], [] as OllamaPull[]);
onEvent(plugin, PULLS_EVENT, (list) => pulls.mutate(list));
// A new model lists in Settings → AI and in every model picker.
onEvent(plugin, INSTALLED_EVENT, () => void refetchProviderStatus());

/** The select's value for Ollama's own unload time (null). */
const OLLAMA_SETTING = '';
const unloadOptions = UNLOAD_AFTER_CHOICES.map((c) => ({ value: c.value === null ? OLLAMA_SETTING : String(c.value), label: c.label }));

const pullText = (p: OllamaPull): string =>
  p.state === 'failed'
    ? `Failed: ${p.error ?? 'unknown error'}`
    : p.total
      ? `${p.step} · ${formatBytes(p.completed)} of ${formatBytes(p.total)} (${percentText(p.completed / p.total)})`
      : p.step;

function OllamaRows() {
  const action = createAction();
  const [name, setName] = createSignal('');
  const install = (): void => void action.run(() => core.pull(name()).then(() => setName('')));
  return (
    <>
      <Row
        label="Address"
        for="ollama-url"
        hint="Where the Ollama server listens."
        control={
          <input
            id="ollama-url"
            type="url"
            class={styles.control}
            value={settings().ollamaUrl}
            onChange={(e) => {
              setSettings({ ...settings(), ollamaUrl: e.currentTarget.value });
              void refetchProviderStatus();
            }}
          />
        }
      />
      <Row
        label="Unload after"
        for="ollama-unload"
        hint="How long a model stays in memory after it answers. Sooner frees the GPU; the next request then waits for the model to load again."
        control={
          <Select
            id="ollama-unload"
            class={styles.control}
            value={settings().unloadAfterS === null ? OLLAMA_SETTING : String(settings().unloadAfterS)}
            options={unloadOptions}
            onChange={(v) => patch({ unloadAfterS: v === OLLAMA_SETTING ? null : Number(v) })}
          />
        }
      />
      <Row
        label="Install a model"
        for="ollama-pull"
        hint={`A name from ollama.com/library. To read images: ${SUGGESTED_VISION_MODEL.id} (${SUGGESTED_VISION_MODEL.note}).`}
        control={
          <div class={styles.install}>
            <input
              id="ollama-pull"
              type="text"
              class={styles.control}
              placeholder={SUGGESTED_VISION_MODEL.id}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && install()}
            />
            <SettingsButton onClick={install}>Install</SettingsButton>
          </div>
        }
      />
      <For each={pulls()}>
        {(p) => (
          <Row
            label={p.model}
            hint={pullText(p)}
            control={<SettingsButton onClick={() => void action.run(() => core.cancelPull(p.model))}>{p.state === 'failed' ? 'Dismiss' : 'Cancel'}</SettingsButton>}
          />
        )}
      </For>
      <ErrorNote error={action.error()} />
      <ErrorNote error={deletes.error()} />
    </>
  );
}

/** Setup steps after the status line, by its model list: none listed (unreachable) or none installed. */
const setupNote = (models: readonly unknown[] | null): string | undefined => {
  if (models === null) return ' Not installed yet? Download it from ollama.com and start it, then Refresh model lists.';
  if (models.length === 0) return ' Install one below: Install a model.';
  return undefined;
};

/** An installed model's Delete, beside its Use choice in Settings → AI; its error shows under Ollama's rows. */
function DeleteModel(props: { model: { id: string } }) {
  return (
    <SettingsButton disabled={deletes.busy()} onClick={() => void deletes.run(() => core.deleteModel(props.model.id))}>
      Delete
    </SettingsButton>
  );
}

export default defineRendererPlugin(plugin, { providers: { ollama: { rows: OllamaRows, note: (status) => setupNote(status.models), modelAction: DeleteModel } } });
