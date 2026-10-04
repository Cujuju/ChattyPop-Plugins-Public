// Image text: reading the text in the images messages show (screenshots, charts) with Windows' OCR or a vision model,
// and translating it with a text model. Settings, status and jobs as core, main and the renderer exchange them.
import { bool, isObj, oneOf, textOrNull, type ModelOption } from '@plugin-sdk/shared';

/** How images are read: Windows' built-in OCR (text only), or a vision model through an AI provider (text and charts). */
export const ENGINES = ['windows', 'vision'] as const;
export type ImageTextEngine = (typeof ENGINES)[number];

export interface ImageTextSettings {
  engine: ImageTextEngine;
  /** The AI provider the vision engine asks (one declared to read images); null = none chosen. */
  visionProvider: string | null;
  /** Its model; null = none chosen (the engine can't run until one is). */
  visionModel: string | null;
  /** Hosted providers may read images, which then leave this computer. Off: only local ones are offered and run. */
  hostedVision: boolean;
  /** Images of new messages, and those Jev still judges (its lookback), are read without being asked. */
  auto: boolean;
  /**
   * Jev is asked about a message again once its image text arrives. Off: only rules' direct matches and the answers the
   * text settles (a cashtag's Trading label) use it.
   */
  askJev: boolean;
  /** Each reading not already in `translateLanguage` is translated with the translation model; both texts are kept. */
  translate: boolean;
  translateLanguage: TranslateLanguage;
  /** The AI provider translations ask; null = none chosen. */
  translateProvider: string | null;
  /** Its model; null = none chosen (nothing is translated until one is). */
  translateModel: string | null;
  /** Providers the owner turned on or off for the Translate image text menu, by id; one not here: on when local. */
  translateMenu: Record<string, boolean>;
}

/** Translation targets offered in Settings. Assumption: widely used languages cover the owner; add one here. */
export const TRANSLATE_LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Russian', 'Japanese', 'Korean', 'Chinese (Simplified)'] as const;
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number];

export const DEFAULT_IMAGE_TEXT_SETTINGS: ImageTextSettings = {
  engine: 'windows',
  visionProvider: 'ollama',
  visionModel: null,
  hostedVision: false,
  auto: true,
  askJev: false,
  translate: false,
  translateLanguage: 'English',
  translateProvider: 'ollama',
  translateModel: null,
  translateMenu: {},
};

export function normalizeImageTextSettings(v: unknown): ImageTextSettings {
  const src = isObj(v) ? v : {};
  const d = DEFAULT_IMAGE_TEXT_SETTINGS;
  return {
    engine: oneOf(ENGINES, src['engine'], d.engine),
    visionProvider: 'visionProvider' in src ? textOrNull(src['visionProvider']) : d.visionProvider,
    visionModel: textOrNull(src['visionModel']),
    hostedVision: bool(src['hostedVision'], d.hostedVision),
    auto: bool(src['auto'], d.auto),
    askJev: bool(src['askJev'], d.askJev),
    translate: bool(src['translate'], d.translate),
    translateLanguage: oneOf(TRANSLATE_LANGUAGES, src['translateLanguage'], d.translateLanguage),
    translateProvider: 'translateProvider' in src ? textOrNull(src['translateProvider']) : d.translateProvider,
    translateModel: textOrNull(src['translateModel']),
    translateMenu: isObj(src['translateMenu']) ? Object.fromEntries(Object.entries(src['translateMenu']).filter((e): e is [string, boolean] => typeof e[1] === 'boolean')) : {},
  };
}

/**
 * Whether the Translate image text menu lists `p`'s models: the owner's switch, else on for a local provider. Cloud ones
 * start off: they may list hundreds of models (OpenRouter) and cost per request.
 */
export function inTranslateMenu(s: ImageTextSettings, p: Pick<ProviderModels, 'id' | 'local'>): boolean {
  return s.translateMenu[p.id] ?? p.local;
}

/** An engine picked for one request (the message menu's Read image text submenu) in place of Settings' choice. */
export type EnginePick = { engine: 'windows' } | { engine: 'vision'; provider: string; model: string };

/** A pick as the renderer sent it, or as a job stored it; null when it isn't one. */
export function normalizePick(v: unknown): EnginePick | null {
  if (!isObj(v)) return null;
  if (v['engine'] === 'windows') return { engine: 'windows' };
  const provider = textOrNull(v['provider']);
  const model = textOrNull(v['model']);
  return v['engine'] === 'vision' && provider && model ? { engine: 'vision', provider, model } : null;
}

/** Why a hosted provider may not read images: the owner hasn't allowed images to leave this computer. */
export const HOSTED_VISION_OFF = 'Sending images to hosted AI is off: Settings → Image text.';

/** A text model picked for one translation (the message menu's Translate image text submenu). */
export interface TranslatePick {
  provider: string;
  model: string;
}

/** A translation pick as the renderer sent it, or as a job stored it; null when it isn't one. */
export function normalizeTranslatePick(v: unknown): TranslatePick | null {
  if (!isObj(v)) return null;
  const provider = textOrNull(v['provider']);
  const model = textOrNull(v['model']);
  return provider && model ? { provider, model } : null;
}

/** queued → fetching (main downloads an image the store doesn't hold) → running → done | failed. */
export type ImageJobState = 'queued' | 'fetching' | 'running' | 'done' | 'failed';

/** Whether an engine can run now, and why not. */
export interface EngineStatus {
  ready: boolean;
  /** One line: what it reads with, or why it can't run. */
  detail: string;
}

/** An AI provider and its models of one kind (that read images, or any for translation). */
export interface ProviderModels {
  id: string;
  label: string;
  /** Runs on this PC. */
  local: boolean;
  /** Why it can't be used now (its plugin is off, it isn't reachable); null while it can. */
  unavailable: string | null;
  /** With what each can do (reads images, thinks) and its size, as the provider lists them. */
  models: ModelOption[];
}

export interface ImageTextStatus {
  windows: EngineStatus;
  vision: EngineStatus;
  /** Providers declared to read images, with their models that do: the vision engine's choices. */
  providers: ProviderModels[];
  /** Settings' translation model: whether it can translate. */
  translator: EngineStatus;
  /** Every available provider with all its models: the translation model's choices. */
  translateProviders: ProviderModels[];
  /** Jobs by state. */
  counts: Record<ImageJobState, number>;
}

/** Core asks main to download an image the store doesn't hold to `path`; main answers with imageFetched. */
export type ImageFetchRequest = {
  /** Names this download in main's answer, so a report from an earlier request or core run is told apart. */
  requestId: number;
  url: string;
  path: string;
} & (
  | { kind: 'attachment'; attachmentId: string; messageId: string; channelId: string }
  /** An image a message's embed or link shows. */
  | { kind: 'shown' }
);
