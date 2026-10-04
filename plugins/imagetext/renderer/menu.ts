// A message's right-click menu: Read image text and Translate image text, each a submenu of the models to use this once.
import { openSettingsAt, type MenuGroup, type MenuItem } from '@plugin-sdk/renderer/kit';
import { IMAGE_TEXT_TAB } from '../shared';
import type { EnginePick, ProviderModels, TranslatePick } from '../shared/types';
import { imageTextSettings, imageTextStatus, requestImageText, translateImageText } from './state';

const READ_LABEL = 'Read image text';
const TRANSLATE_LABEL = 'Translate image text';
/** Marks the submenu's model that Settings → Image text uses. */
const SETTINGS_DETAIL = 'Your setting';

/** Runs an owner's request; when Settings' choice (no pick) can't run, Settings says why. */
async function ask(label: string, call: () => Promise<void>, settingsReady: () => boolean | undefined, picked: boolean): Promise<void> {
  try {
    await call();
  } catch (err) {
    if (!picked && settingsReady() === false) openSettingsAt(IMAGE_TEXT_TAB);
    else console.warn(`[imagetext] ${label.toLowerCase()}:`, err); // a linked post with no photos, or a picked model gone
  }
}

const readImages = (messageId: string, pick: EnginePick | null): Promise<void> =>
  ask(READ_LABEL, () => requestImageText(messageId, pick), () => imageTextStatus()?.[imageTextSettings().engine].ready, pick !== null);

const translateImages = (messageId: string, pick: TranslatePick | null): Promise<void> =>
  ask(TRANSLATE_LABEL, () => translateImageText(messageId, pick), () => imageTextStatus()?.translator.ready, pick !== null);

/** A group per provider that can be used now, headed by its name, of an item per model. */
function modelGroups(providers: readonly ProviderModels[], item: (p: ProviderModels, model: ProviderModels['models'][number]) => MenuItem): MenuGroup[] {
  return providers.filter((p) => !p.unavailable && p.models.length).map((p) => ({ heading: p.label, items: p.models.map((m) => item(p, m)) }));
}

/** Every engine that can read now: Windows OCR, then each provider's vision models. Empty while status is unknown. */
function engineGroups(messageId: string): MenuGroup[] {
  const status = imageTextStatus();
  if (!status) return [];
  const s = imageTextSettings();
  const detail = (mine: boolean): string | undefined => (mine ? SETTINGS_DETAIL : undefined);
  const windows: MenuGroup[] = status.windows.ready
    ? [{ items: [{ label: 'Windows OCR', icon: 'text', detail: detail(s.engine === 'windows'), run: () => readImages(messageId, { engine: 'windows' }) }] }]
    : [];
  const vision = modelGroups(status.providers, (p, m) => ({
    label: m.label,
    icon: 'image',
    detail: detail(s.engine === 'vision' && s.visionProvider === p.id && s.visionModel === m.id),
    run: () => readImages(messageId, { engine: 'vision', provider: p.id, model: m.id }),
  }));
  return [...windows, ...vision];
}

/** Every model that can translate now, by provider. Empty while status is unknown. */
function translatorGroups(messageId: string): MenuGroup[] {
  const s = imageTextSettings();
  return modelGroups(imageTextStatus()?.translateProviders ?? [], (p, m) => ({
    label: m.label,
    icon: 'text',
    detail: s.translateProvider === p.id && s.translateModel === m.id ? SETTINGS_DETAIL : undefined,
    run: () => translateImages(messageId, { provider: p.id, model: m.id }),
  }));
}

/** An item of the models in `groups`; with none able to run, Settings' choice, whose failure opens Settings. */
const pickItem = (label: string, icon: MenuItem['icon'], groups: MenuGroup[], fallback: () => Promise<void>): MenuItem =>
  groups.length ? { label, icon, submenu: groups } : { label, icon, run: fallback };

/** The message's Read image text and Translate image text items. */
export const imageTextItems = (messageId: string): MenuItem[] => [
  pickItem(READ_LABEL, 'image', engineGroups(messageId), () => readImages(messageId, null)),
  pickItem(TRANSLATE_LABEL, 'text', translatorGroups(messageId), () => translateImages(messageId, null)),
];
