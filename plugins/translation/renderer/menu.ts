// A message's right-click menu: Translate, a submenu of the models to translate with this once.
import { openSettingsAt, type MenuGroup, type MenuItem } from '@plugin-sdk/renderer/kit';
import { TRANSLATION_TAB } from '../shared';
import { inTranslateMenu, type TranslatePick } from '../shared/types';
import { translateMessage, translationSettings, translationStatus } from './state';

const LABEL = 'Translate';
/** Marks the submenu's model that Settings → Translation uses. */
const SETTINGS_DETAIL = 'Your setting';

/** Runs the owner's request; when Settings' model (no pick) can't run, Settings → Translation says why. */
async function translate(messageId: string, pick: TranslatePick | null): Promise<void> {
  try {
    await translateMessage(messageId, pick);
  } catch (err) {
    if (!pick && translationStatus()?.translator.ready === false) openSettingsAt(TRANSLATION_TAB);
    else console.warn('[translation] translate:', err); // a message with no text yet, or a picked model gone
  }
}

/** A group per listed provider that can be used now (Settings → Translation), of an item per model. Empty while status is unknown. */
function modelGroups(messageId: string): MenuGroup[] {
  const s = translationSettings();
  const listed = (translationStatus()?.providers ?? []).filter((p) => inTranslateMenu(s, p) && !p.unavailable && p.models.length);
  return listed.map((p) => ({
    heading: p.label,
    items: p.models.map((m) => ({
      label: m.label,
      icon: 'text' as const,
      detail: s.translateProvider === p.id && s.translateModel === m.id ? SETTINGS_DETAIL : undefined,
      run: () => translate(messageId, { provider: p.id, model: m.id }),
    })),
  }));
}

/** The message's Translate item; with no model able to run, Settings' choice, whose failure opens Settings. */
export function translateItem(messageId: string): MenuItem {
  const groups = modelGroups(messageId);
  return groups.length ? { label: LABEL, icon: 'text', submenu: groups } : { label: LABEL, icon: 'text', run: () => translate(messageId, null) };
}
