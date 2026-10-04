// Image text's renderer side: Settings → Image text, and Read image text (a submenu of engines) in a message's right-click menu.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { openSettingsAt, type MenuGroup, type MenuItem } from '@plugin-sdk/renderer/kit';
import { X_STATUS_PATH, embedShowsPictures, mediaKind, type ArchiveEmbed, type ArchiveMessage } from '@plugin-sdk/shared';
import { IMAGE_TEXT_TAB, plugin } from '../shared';
import type { EnginePick } from '../shared/types';
import { ImageTextSection } from './ImageTextSection';
import { imageTextSettings, imageTextStatus, requestImageText } from './state';

// The same tests as core's image list (archive.images).
const mayBeImage = (a: ArchiveMessage['attachments'][number]): boolean => mediaKind(a) === 'image';
const showsImage = (e: ArchiveEmbed): boolean => embedShowsPictures(e.type) && !!(e.imageUrl || e.thumbnailUrl);
/** Links whose post Links may fetch with its photos (link images, which ArchiveMessage doesn't carry). */
const URL_IN_TEXT = /https?:\/\/\S+/g;
const linksPost = (m: ArchiveMessage): boolean => (m.content.match(URL_IN_TEXT) ?? []).some((u) => X_STATUS_PATH.test(u));
const hasImages = (m: ArchiveMessage): boolean => m.attachments.some(mayBeImage) || m.embeds.some(showsImage) || linksPost(m);

const READ_LABEL = 'Read image text';
/** Marks the submenu's engine that Settings → Image text reads with. */
const SETTINGS_DETAIL = 'Your setting';

/** Asks core to read the message's images with `pick` (null: Settings' engine); when that can't run, Settings says why. */
async function readImages(messageId: string, pick: EnginePick | null): Promise<void> {
  try {
    await requestImageText(messageId, pick);
  } catch (err) {
    if (!pick && imageTextStatus()?.[imageTextSettings().engine].ready === false) openSettingsAt(IMAGE_TEXT_TAB);
    else console.warn('[imagetext] read image text:', err); // a linked post with no photos, or a picked engine gone
  }
}

/** Settings → Image text reads with `pick`. */
function isSettings(pick: EnginePick): boolean {
  const s = imageTextSettings();
  return pick.engine === 'windows' ? s.engine === 'windows' : s.engine === 'vision' && s.visionProvider === pick.provider && s.visionModel === pick.model;
}

/** Every engine that can read now, for one reading: Windows OCR, then each provider's vision models. Empty while status is unknown. */
function engineGroups(messageId: string): MenuGroup[] {
  const status = imageTextStatus();
  if (!status) return [];
  const item = (label: string, icon: MenuItem['icon'], pick: EnginePick): MenuItem => ({
    label,
    icon,
    detail: isSettings(pick) ? SETTINGS_DETAIL : undefined,
    run: () => readImages(messageId, pick),
  });
  const windows: MenuGroup[] = status.windows.ready ? [{ items: [item('Windows OCR', 'text', { engine: 'windows' })] }] : [];
  const vision = status.providers
    .filter((p) => !p.unavailable && p.models.length)
    .map((p): MenuGroup => ({ heading: p.label, items: p.models.map((m) => item(m.label, 'image', { engine: 'vision', provider: p.id, model: m.id })) }));
  return [...windows, ...vision];
}

/** Read image text: a submenu of the engines; with none able to run, Settings' engine, whose failure opens Settings. */
function readItem(messageId: string): MenuItem {
  const engines = engineGroups(messageId);
  return engines.length ? { label: READ_LABEL, icon: 'image', submenu: engines } : { label: READ_LABEL, icon: 'image', run: () => readImages(messageId, null) };
}

export default defineRendererPlugin(plugin, {
  settings: { [IMAGE_TEXT_TAB]: { body: ImageTextSection } },
  messageMenu: {
    readImages: {
      // Desktop windows only: the phone can't request image text or open Settings.
      calls: ['request'],
      menu: (m) => (hasImages(m) ? [readItem(m.id)] : []),
    },
  },
});
