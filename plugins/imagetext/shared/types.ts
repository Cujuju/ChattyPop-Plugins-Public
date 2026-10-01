// Image text: reading the text in the images messages show (screenshots, charts) with Windows' OCR or a vision model.
// Settings, status and jobs as core, main and the renderer exchange them.
import { bool, isObj, oneOf, textOrNull } from '@plugin-sdk/shared';

/** How images are read: Windows' built-in OCR (text only), or a vision model through an AI provider (text and charts). */
export const ENGINES = ['windows', 'vision'] as const;
export type ImageTextEngine = (typeof ENGINES)[number];

export interface ImageTextSettings {
  engine: ImageTextEngine;
  /** The AI provider the vision engine asks (one declared to read images); null = none chosen. */
  visionProvider: string | null;
  /** Its model; null = none chosen (the engine can't run until one is). */
  visionModel: string | null;
  /** Images of new messages, and those Jev still judges (its lookback), are read without being asked. */
  auto: boolean;
  /**
   * Jev is asked about a message again once its image text arrives. Off: only rules' direct matches and the answers the
   * text settles (a cashtag's Trading label) use it.
   */
  askJev: boolean;
}

export const DEFAULT_IMAGE_TEXT_SETTINGS: ImageTextSettings = { engine: 'windows', visionProvider: 'ollama', visionModel: null, auto: true, askJev: false };

export function normalizeImageTextSettings(v: unknown): ImageTextSettings {
  const src = isObj(v) ? v : {};
  const d = DEFAULT_IMAGE_TEXT_SETTINGS;
  return {
    engine: oneOf(ENGINES, src['engine'], d.engine),
    visionProvider: 'visionProvider' in src ? textOrNull(src['visionProvider']) : d.visionProvider,
    visionModel: textOrNull(src['visionModel']),
    auto: bool(src['auto'], d.auto),
    askJev: bool(src['askJev'], d.askJev),
  };
}

/** queued → fetching (main downloads an image the store doesn't hold) → running → done | failed. */
export type ImageJobState = 'queued' | 'fetching' | 'running' | 'done' | 'failed';

/** Whether an engine can run now, and why not. */
export interface EngineStatus {
  ready: boolean;
  /** One line: what it reads with, or why it can't run. */
  detail: string;
}

/** A model the vision engine may use: one its provider says reads images. */
export interface VisionModel {
  id: string;
  label: string;
}

/** A provider declared to read images, and its models that do. */
export interface VisionProvider {
  id: string;
  label: string;
  /** Why it can't be used now (its plugin is off, it isn't reachable); null while it can. */
  unavailable: string | null;
  models: VisionModel[];
}

export interface ImageTextStatus {
  windows: EngineStatus;
  vision: EngineStatus;
  /** Providers the vision engine can pick from. */
  providers: VisionProvider[];
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
