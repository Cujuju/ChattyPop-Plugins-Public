// Translates message-part text into the owner's language. Part-specific derived translations feed rules, Jev, and search.
import { defineChannels, definePlugin, definePreference } from '@plugin-sdk/shared';
import { decodeNoArgs, decodeTranslate } from './calls';
import { DEFAULT_TRANSLATION_SETTINGS, normalizeTranslationSettings, type TranslatePick, type TranslationStatus } from './types';
import { translated } from './rules';

export const manifest = {
  id: 'translation',
  name: 'Translation',
  version: '1.1.1',
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
  /** Translates all textual message parts with pick or Settings' model. Throws for an unavailable model or absent text. */
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
      status: { audiences: ['renderer', 'phone'], writes: false, decode: decodeNoArgs },
      translate: { audiences: ['renderer', 'phone'], writes: true, decode: decodeTranslate },
      retryFailed: { audiences: ['renderer', 'phone'], writes: true, decode: decodeNoArgs },
    },
    events: { [STATUS_EVENT]: ['renderer', 'phone'] },
  }),
  settings: [
    // A glyph and a letter A: one language into another.
    { id: TRANSLATION_TAB, label: 'Translation', tab: { after: 'transcription', iconPath: 'M3 5h8M7 3v2M5 5c0 4 2.5 6.5 6 8M9 5c0 4-2.5 6.5-6 8M13 21l4-9 4 9M14.5 18h5' } },
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
