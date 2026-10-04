// Settings → Translation: which texts are translated automatically, into what, with which model, and its queue.
import { For, Show } from 'solid-js';
import { TRANSLATION_TAB } from '../shared';
import { inTranslateMenu, TRANSLATE_LANGUAGES, type ProviderModels, type TranslateLanguage, type TranslationSettings } from '../shared/types';
import { retryFailedTranslations, patchTranslationSettings, translationSettings, translationStatus } from './state';
import { Card, createAction, ErrorNote, ModelRows, Note, Page, Row, Select, SettingsButton, Switch } from '@plugin-sdk/renderer/kit';
import styles from './Translation.module.css';

type AutoField = 'translate' | 'translateTranscripts' | 'translateEmbedText';

/** The automatic switches: each kind of text, and what it is. */
const AUTO_ROWS: readonly { field: AutoField; label: string; hint: string }[] = [
  { field: 'translate', label: 'Translate image text automatically', hint: 'The text Image text reads from screenshots and charts.' },
  { field: 'translateTranscripts', label: 'Translate transcripts automatically', hint: 'Voice messages, audio and videos Transcription turned into text.' },
  { field: 'translateEmbedText', label: 'Translate link previews and posts automatically', hint: 'A link preview’s whole card, with a fetched post’s full text, or a linked post’s text when no card shows it.' },
];

/** The model's state and its one-line detail; unknown while status hasn't loaded. */
const translatorHint = (): string => {
  const t = translationStatus()?.translator;
  return t ? `${t.ready ? 'Ready' : 'Can’t run'} · ${t.detail}` : 'Status unknown';
};

/** Settings → Translation: image text, transcripts and link previews into the owner's language, with a text model. */
export function TranslationSection() {
  const action = createAction();
  const s = translationSettings;
  const counts = () => translationStatus()?.counts;
  const queueText = () => {
    const c = counts();
    return c ? `${c.queued} queued · ${c.running} translating · ${c.done} done · ${c.failed} failed` : 'Status unknown';
  };
  return (
    <Page id={TRANSLATION_TAB} title="Translation" lede="Translates image text, transcripts and link previews into your language, with a text model. Both texts are kept, so rules and search match either.">
      <Card title="Automatic">
        <For each={AUTO_ROWS}>
          {(r) => (
            <Row
              label={r.label}
              for={`translation-${r.field}`}
              hint={`${r.hint} New messages’, and those of the last day that Jev still judges, when not already in ${s().translateLanguage}.`}
              control={<Switch id={`translation-${r.field}`} checked={s()[r.field]} onChange={(on) => patchTranslationSettings({ [r.field]: on } as Partial<TranslationSettings>)} />}
            />
          )}
        </For>
        <Note>Others: right-click a message → Translate.</Note>
      </Card>
      <Card title="Model">
        <Row
          label="Into"
          for="translation-language"
          control={
            <Select
              id="translation-language"
              class={styles.control}
              value={s().translateLanguage}
              options={TRANSLATE_LANGUAGES.map((l) => ({ value: l, label: l }))}
              onChange={(v) => patchTranslationSettings({ translateLanguage: v as TranslateLanguage })}
            />
          }
        />
        <ModelRows
          id="translation-model"
          providers={translationStatus()?.providers ?? []}
          providerId={s().translateProvider}
          modelId={s().translateModel}
          onChange={(translateProvider, translateModel) => patchTranslationSettings({ translateProvider, translateModel })}
          none="No AI provider is on."
        />
        <Note>{translatorHint()}</Note>
        <MenuProviderRows />
      </Card>
      <Card title="Queue">
        <Row
          label="Translations"
          hint={queueText()}
          control={
            <Show when={(counts()?.failed ?? 0) > 0}>
              <SettingsButton onClick={() => void action.run(retryFailedTranslations)}>Retry failed</SettingsButton>
            </Show>
          }
        />
      </Card>
      <ErrorNote error={action.error()} />
    </Page>
  );
}

/** A switch per provider: whether a message's Translate menu lists its models. */
function MenuProviderRows() {
  const s = translationSettings;
  const providers = () => translationStatus()?.providers ?? [];
  const hint = (p: ProviderModels): string => p.unavailable ?? `${p.models.length} ${p.models.length === 1 ? 'model' : 'models'}${p.local ? ' · on this computer' : ''}`;
  return (
    <Show when={providers().length}>
      <Note>In a message’s Translate menu:</Note>
      <For each={providers()}>
        {(p) => (
          <Row
            label={p.label}
            for={`translation-menu-${p.id}`}
            hint={hint(p)}
            control={<Switch id={`translation-menu-${p.id}`} checked={inTranslateMenu(s(), p)} onChange={(on) => patchTranslationSettings({ translateMenu: { ...s().translateMenu, [p.id]: on } })} />}
          />
        )}
      </For>
    </Show>
  );
}
