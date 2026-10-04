// Settings → Translation: translating the text images show, automatically or from a message's menu, and its model.
import { For, Show } from 'solid-js';
import { TRANSLATION_TAB } from '../shared';
import { inTranslateMenu, TRANSLATE_LANGUAGES, type ProviderModels, type TranslateLanguage } from '../shared/types';
import { imageTextSettings, imageTextStatus, patchImageTextSettings } from './state';
import { Card, Note, Page, Row, Select, Switch } from '@plugin-sdk/renderer/kit';
import { engineHint } from './ImageTextSection';
import { ModelRows } from './ModelRows';
import styles from './ImageText.module.css';

/** Settings → Translation: image text into the owner's language, with a text model. */
export function TranslationSection() {
  const s = imageTextSettings;
  return (
    <Page id={TRANSLATION_TAB} title="Translation" lede="Translates the text read from images (Settings → Image text) into your language, with a text model.">
      <Card title="Translation">
        <Row
          label="Translate image text automatically"
          for="imagetext-translate"
          hint={`Each image’s text not already in ${s().translateLanguage} is translated; both are kept, so rules and search match either. Others: right-click a message → Translate image text. ${engineHint(imageTextStatus()?.translator)}`}
          control={<Switch id="imagetext-translate" checked={s().translate} onChange={(translate) => patchImageTextSettings({ translate })} />}
        />
        <Row
          label="Into"
          for="imagetext-translate-language"
          control={
            <Select
              id="imagetext-translate-language"
              class={styles.control}
              value={s().translateLanguage}
              options={TRANSLATE_LANGUAGES.map((l) => ({ value: l, label: l }))}
              onChange={(v) => patchImageTextSettings({ translateLanguage: v as TranslateLanguage })}
            />
          }
        />
        <ModelRows
          id="imagetext-translate"
          providers={imageTextStatus()?.translateProviders ?? []}
          providerId={s().translateProvider}
          modelId={s().translateModel}
          onChange={(translateProvider, translateModel) => patchImageTextSettings({ translateProvider, translateModel })}
          none="No AI provider is on."
        />
        <MenuProviderRows />
      </Card>
    </Page>
  );
}

/** A switch per provider: whether a message's Translate image text menu lists its models. */
function MenuProviderRows() {
  const s = imageTextSettings;
  const providers = () => imageTextStatus()?.translateProviders ?? [];
  const hint = (p: ProviderModels): string =>
    p.unavailable ?? `${p.models.length} ${p.models.length === 1 ? 'model' : 'models'}${p.local ? ' · on this computer' : ''}`;
  return (
    <Show when={providers().length}>
      <Note>In a message’s Translate image text menu:</Note>
      <For each={providers()}>
        {(p) => (
          <Row
            label={p.label}
            for={`imagetext-translate-menu-${p.id}`}
            hint={hint(p)}
            control={
              <Switch
                id={`imagetext-translate-menu-${p.id}`}
                checked={inTranslateMenu(s(), p)}
                onChange={(on) => patchImageTextSettings({ translateMenu: { ...s().translateMenu, [p.id]: on } })}
              />
            }
          />
        )}
      </For>
    </Show>
  );
}
