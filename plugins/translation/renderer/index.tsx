// Translation's renderer side: Settings → Translation, and Translate in a message's right-click menu.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { X_STATUS_PATH, embedShowsPictures, mediaKind, type ArchiveEmbed, type ArchiveMessage } from '@plugin-sdk/shared';
import { TRANSLATION_TAB, plugin } from '../shared';
import { translateItem } from './menu';
import { TranslationSection } from './TranslationSection';

// The parts core translates (archive.parts): media other plugins read, and embeds' own text.
const hasMedia = (a: ArchiveMessage['attachments'][number]): boolean => mediaKind(a) !== 'file';
const hasParts = (e: ArchiveEmbed): boolean => !!(e.title || e.description || e.videoUrl || (embedShowsPictures(e.type) && (e.imageUrl || e.thumbnailUrl)));
/** Links whose post Links may fetch with its photos (link images, which ArchiveMessage doesn't carry). */
const URL_IN_TEXT = /https?:\/\/\S+/g;
const linksPost = (m: ArchiveMessage): boolean => (m.content.match(URL_IN_TEXT) ?? []).some((u) => X_STATUS_PATH.test(u));
const mayTranslate = (m: ArchiveMessage): boolean => m.attachments.some(hasMedia) || m.embeds.some(hasParts) || linksPost(m);

export default defineRendererPlugin(plugin, {
  settings: { [TRANSLATION_TAB]: { body: TranslationSection } },
  messageMenu: {
    translate: {
      // Desktop windows only: the phone can't request a translation or open Settings.
      calls: ['translate'],
      menu: (m) => (mayTranslate(m) ? [translateItem(m.id)] : []),
    },
  },
});
