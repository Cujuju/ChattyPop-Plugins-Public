// Shared settings, status, and job types for Windows OCR and vision-model image reading.
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
  /** Image attachments of new messages, and of those Jev still judges (its lookback), are read without being asked. */
  autoAttachments: boolean;
  /** As autoAttachments, for link previews' (embeds') images. */
  autoEmbeds: boolean;
  /** As autoAttachments, for fetched posts' photos (link images). */
  autoLinks: boolean;
  /** Enables Jev reevaluation after image text arrives. When off, direct rules and text-settled labels still update. */
  askJev: boolean;
}

export const DEFAULT_IMAGE_TEXT_SETTINGS: ImageTextSettings = {
  engine: 'windows',
  visionProvider: 'ollama',
  visionModel: null,
  hostedVision: false,
  autoAttachments: true,
  autoEmbeds: true,
  autoLinks: true,
  askJev: false,
};

export function normalizeImageTextSettings(v: unknown): ImageTextSettings {
  const src = isObj(v) ? v : {};
  const d = DEFAULT_IMAGE_TEXT_SETTINGS;
  // Legacy auto applies to all sources. Saving removes it; older builds then use default automatic reading while retaining hosted vision settings.
  const auto = (field: string, fallback: boolean): boolean => bool(src[field], bool(src['auto'], fallback));
  return {
    engine: oneOf(ENGINES, src['engine'], d.engine),
    visionProvider: 'visionProvider' in src ? textOrNull(src['visionProvider']) : d.visionProvider,
    visionModel: textOrNull(src['visionModel']),
    hostedVision: bool(src['hostedVision'], d.hostedVision),
    autoAttachments: auto('autoAttachments', d.autoAttachments),
    autoEmbeds: auto('autoEmbeds', d.autoEmbeds),
    autoLinks: auto('autoLinks', d.autoLinks),
    askJev: bool(src['askJev'], d.askJev),
  };
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

/** queued → fetching (main downloads an image the store doesn't hold) → running → done | failed. */
export type ImageJobState = 'queued' | 'fetching' | 'running' | 'done' | 'failed';

/** Whether an engine can run now, and why not. */
export interface EngineStatus {
  ready: boolean;
  /** One line: what it reads with, or why it can't run. */
  detail: string;
}

/** An AI provider and its models that read images. */
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
