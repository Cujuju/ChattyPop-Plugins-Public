// A message's right-click menu: Read image text, a submenu of the engines to read with this once.
import { openSettingsAt, type MenuGroup, type MenuItem } from '@plugin-sdk/renderer/kit';
import { IMAGE_TEXT_TAB } from '../shared';
import type { EnginePick } from '../shared/types';
import { imageTextSettings, imageTextStatus, requestImageText } from './state';

const READ_LABEL = 'Read image text';
/** Marks the submenu's engine that Settings → Image text uses. */
const SETTINGS_DETAIL = 'Your setting';

/** Reads the message's images; when Settings' engine (no pick) can't run, Settings → Image text says why. */
async function readImages(messageId: string, pick: EnginePick | null): Promise<void> {
  try {
    await requestImageText(messageId, pick);
  } catch (err) {
    if (!pick && imageTextStatus()?.[imageTextSettings().engine].ready === false) openSettingsAt(IMAGE_TEXT_TAB);
    else console.warn('[imagetext] read image text:', err); // a linked post with no photos, or a picked model gone
  }
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
  // A group per provider that can be used now, headed by its name.
  const vision: MenuGroup[] = status.providers
    .filter((p) => !p.unavailable && p.models.length)
    .map((p) => ({
      heading: p.label,
      items: p.models.map((m) => ({
        label: m.label,
        icon: 'image' as const,
        detail: detail(s.engine === 'vision' && s.visionProvider === p.id && s.visionModel === m.id),
        run: () => readImages(messageId, { engine: 'vision', provider: p.id, model: m.id }),
      })),
    }));
  return [...windows, ...vision];
}

/** The message's Read image text item; with no engine able to run, Settings' choice, whose failure opens Settings. */
export function imageTextItem(messageId: string): MenuItem {
  const groups = engineGroups(messageId);
  return groups.length ? { label: READ_LABEL, icon: 'image', submenu: groups } : { label: READ_LABEL, icon: 'image', run: () => readImages(messageId, null) };
}
