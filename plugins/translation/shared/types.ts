// Shared translation settings, model picks, and status for image text, transcripts, and embed text.
import { bool, isObj, oneOf, textOrNull, type ModelOption } from '@plugin-sdk/shared';

/** What a part's text is, so each is translated automatically or not: Image text's, a transcript, an embed's own. */
export const SOURCE_KINDS = ['image-text', 'transcript', 'embed-text'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Translation languages offered in Settings. */
export const TRANSLATE_LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Russian', 'Japanese', 'Korean', 'Chinese (Simplified)'] as const;
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number];

export interface TranslationSettings {
  /** Automatic image-text translation switch adopted from Image text. checkBundled requires the adopted field in defaults. */
  translate: boolean;
  /** As `translate`, for transcripts. */
  translateTranscripts: boolean;
  /** As `translate`, for embeds' own text (a card's title and its fetched post, else description) and the text of links no card shows. */
  translateEmbedText: boolean;
  translateLanguage: TranslateLanguage;
  /** The AI provider translations ask; null = none chosen. */
  translateProvider: string | null;
  /** Its model; null = none chosen (nothing is translated until one is). */
  translateModel: string | null;
  /** Providers the owner turned on or off for the Translate menu, by id; one not here: on when local. */
  translateMenu: Record<string, boolean>;
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  translate: false,
  translateTranscripts: false,
  translateEmbedText: false,
  translateLanguage: 'English',
  translateProvider: 'ollama',
  translateModel: null,
  translateMenu: {},
};

export function normalizeTranslationSettings(v: unknown): TranslationSettings {
  const src = isObj(v) ? v : {};
  const d = DEFAULT_TRANSLATION_SETTINGS;
  return {
    translate: bool(src['translate'], d.translate),
    translateTranscripts: bool(src['translateTranscripts'], d.translateTranscripts),
    translateEmbedText: bool(src['translateEmbedText'], d.translateEmbedText),
    translateLanguage: oneOf(TRANSLATE_LANGUAGES, src['translateLanguage'], d.translateLanguage),
    translateProvider: 'translateProvider' in src ? textOrNull(src['translateProvider']) : d.translateProvider,
    translateModel: textOrNull(src['translateModel']),
    translateMenu: isObj(src['translateMenu']) ? Object.fromEntries(Object.entries(src['translateMenu']).filter((e): e is [string, boolean] => typeof e[1] === 'boolean')) : {},
  };
}

/** Whether Settings translates `kind` automatically. */
export const autoFor = (s: TranslationSettings, kind: SourceKind): boolean =>
  kind === 'image-text' ? s.translate : kind === 'transcript' ? s.translateTranscripts : s.translateEmbedText;

/** Model-menu inclusion follows the owner's switch, defaulting on for local providers and off for cloud providers. */
export function inTranslateMenu(s: TranslationSettings, p: Pick<ProviderModels, 'id' | 'local'>): boolean {
  return s.translateMenu[p.id] ?? p.local;
}

/** A text model picked for one translation (the message menu's Translate submenu). */
export interface TranslatePick {
  provider: string;
  model: string;
}

/** A pick as the renderer sent it, or as a job stored it; null when it isn't one. */
export function normalizeTranslatePick(v: unknown): TranslatePick | null {
  if (!isObj(v)) return null;
  const provider = textOrNull(v['provider']);
  const model = textOrNull(v['model']);
  return provider && model ? { provider, model } : null;
}

/** queued → running → done | failed. */
export type TranslationJobState = 'queued' | 'running' | 'done' | 'failed';

/** Whether the translation model can run now, and why not. */
export interface TranslatorStatus {
  ready: boolean;
  /** One line: provider and model, or why it can't run. */
  detail: string;
}

/** An AI provider and all its models: the translation model's choices. */
export interface ProviderModels {
  id: string;
  label: string;
  /** Runs on this PC. */
  local: boolean;
  /** Why it can't be used now (its plugin is off, it isn't reachable); null while it can. */
  unavailable: string | null;
  models: ModelOption[];
}

export interface TranslationStatus {
  /** Settings' translation model. */
  translator: TranslatorStatus;
  providers: ProviderModels[];
  /** Jobs by state. */
  counts: Record<TranslationJobState, number>;
}
