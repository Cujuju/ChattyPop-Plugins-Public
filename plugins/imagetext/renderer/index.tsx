// Image text's renderer side: Settings → Image text, and Read image text in a message's right-click menu.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { X_STATUS_PATH, embedShowsPictures, mediaKind, type ArchiveEmbed, type ArchiveMessage } from '@plugin-sdk/shared';
import { IMAGE_TEXT_TAB, plugin } from '../shared';
import { ImageTextSection } from './ImageTextSection';
import { imageTextItem } from './menu';

// The same tests as core's image list (archive.images).
const mayBeImage = (a: ArchiveMessage['attachments'][number]): boolean => mediaKind(a) === 'image';
const showsImage = (e: ArchiveEmbed): boolean => embedShowsPictures(e.type) && !!(e.imageUrl || e.thumbnailUrl);
/** Links whose post Links may fetch with its photos (link images, which ArchiveMessage doesn't carry). */
const URL_IN_TEXT = /https?:\/\/\S+/g;
const linksPost = (m: ArchiveMessage): boolean => (m.content.match(URL_IN_TEXT) ?? []).some((u) => X_STATUS_PATH.test(u));
const hasImages = (m: ArchiveMessage): boolean => m.attachments.some(mayBeImage) || m.embeds.some(showsImage) || linksPost(m);

export default defineRendererPlugin(plugin, {
  settings: { [IMAGE_TEXT_TAB]: { body: ImageTextSection } },
  messageMenu: {
    readImages: {
      // Desktop windows only: the phone can't request image text or open Settings.
      calls: ['request'],
      menu: (m) => (hasImages(m) ? [imageTextItem(m.id)] : []),
    },
  },
});
