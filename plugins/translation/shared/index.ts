// Translation: translates the text of a message's parts (Image text's readings, transcripts, embeds' own text) into the
// owner's language with a text model. Its translations are derived text of their part: rules, Jev and search read them.
import { defineChannels, definePlugin, definePreference } from '@plugin-sdk/shared';
import { DEFAULT_TRANSLATION_SETTINGS, normalizeTranslationSettings, type TranslatePick, type TranslationStatus } from './types';
import { translated } from './rules';

export const manifest = {
  id: 'translation',
  name: 'Translation',
  version: '1.0.0',
  description: 'Translates image text, transcripts and link previews into your language with an AI model, so rules, Jev and search see it.',
};

/** Settings tab id. */
export const TRANSLATION_TAB = 'translation' as const;
/** Plugin event: queue counts changed; the renderer reads the status again. */
export const STATUS_EVENT = 'status' as const;
/** AttachmentNote.kind of a translation. */
export const TRANSLATION_NOTE = 'translation';
/** Where Image text's settings were kept, before translating moved here. */
const IMAGE_TEXT_SETTINGS_KEY = 'plugin.imagetext.settings';

/** Core's calls, from Settings and the message menu. */
export interface TranslationCoreCalls {
  /** The translation model and the queue. */
  status(): Promise<TranslationStatus>;
  /**
   * Translates every part of the message that has text, however old, with `pick` (null: Settings' model). Throws when
   * that model can't run, or the message has no such text.
   */
  translate(messageId: string, pick: TranslatePick | null): void;
  /** Queues again every translation that failed. */
  retryFailed(): void;
}

export interface TranslationEvents {
  [STATUS_EVENT]: null;
}

export const plugin = definePlugin({
  manifest,
  channels: defineChannels<{ core: TranslationCoreCalls; events: TranslationEvents }>()({
    core: {
      status: { audiences: ['renderer'], writes: false },
      translate: ['renderer'],
      retryFailed: ['renderer'],
    },
    events: { [STATUS_EVENT]: ['renderer'] },
  }),
  settings: [
    // A glyph and a letter A: one language into another.
    { id: TRANSLATION_TAB, label: 'Translation', tab: { after: 'imagetext', iconPath: 'M3 5h8M7 3v2M5 5c0 4 2.5 6.5 6 8M9 5c0 4-2.5 6.5-6 8M13 21l4-9 4 9M14.5 18h5' } },
  ],
  /** Settings → Translation. */
  preferences: { settings: definePreference({ default: DEFAULT_TRANSLATION_SETTINGS, normalize: normalizeTranslationSettings }) },
  slots: { messageMenu: [{ id: 'translate', after: 'imagetext.readImages' }] },
  rules: { filters: [translated] },
  // Image text translated its readings before this plugin: its settings, its automatic switch (`translate`) included.
  adopts: {
    settingFields: [
      { key: IMAGE_TEXT_SETTINGS_KEY, field: 'translate', name: 'settings' },
      { key: IMAGE_TEXT_SETTINGS_KEY, field: 'translateLanguage', name: 'settings' },
      { key: IMAGE_TEXT_SETTINGS_KEY, field: 'translateProvider', name: 'settings' },
      { key: IMAGE_TEXT_SETTINGS_KEY, field: 'translateModel', name: 'settings' },
      { key: IMAGE_TEXT_SETTINGS_KEY, field: 'translateMenu', name: 'settings' },
    ],
  },
});
export default plugin;
