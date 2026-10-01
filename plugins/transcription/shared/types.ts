// Local speech-to-text (whisper.cpp + ffmpeg): settings, toolchain status and transcripts as core and renderer exchange them.
import { bool, isObj, textOrNull } from '@plugin-sdk/shared';

export interface TranscriptionSettings {
  /** New voice messages are transcribed once their audio is archived. */
  autoVoice: boolean;
  /** Voice messages sent before this are only transcribed on request; core sets it when autoVoice is first seen on. */
  autoSince: number | null;
  /** Catalog id of the whisper model to use; null = none chosen. */
  model: string | null;
}

export const DEFAULT_TRANSCRIPTION_SETTINGS: TranscriptionSettings = { autoVoice: true, autoSince: null, model: null };

export function normalizeTranscriptionSettings(v: unknown): TranscriptionSettings {
  const src = isObj(v) ? v : {};
  const since = Number(src['autoSince']);
  return {
    autoVoice: bool(src['autoVoice'], DEFAULT_TRANSCRIPTION_SETTINGS.autoVoice),
    autoSince: src['autoSince'] !== null && Number.isFinite(since) && since > 0 ? since : null,
    model: textOrNull(src['model'], false),
  };
}

export type InstallState = 'missing' | 'downloading' | 'installing' | 'ready' | 'failed';

/** A program's Windows build: `gpu` runs on an NVIDIA GPU (CUDA), `cpu` anywhere. */
export type ToolBuild = 'gpu' | 'cpu';

/** A model's measured quality and speed (method: catalog.ts). */
export interface ModelScore {
  /** Percent of words right (100 − word error rate). */
  accuracy: number;
  /** Seconds of voice message transcribed per second, per whisper.cpp build. */
  speed: Record<ToolBuild, number>;
}

/** A program or model ChattyPop can download. */
export interface InstallItem {
  /** Unique across tools and models. */
  id: string;
  label: string;
  description: string;
  /** Download size (a tool's recommended build). */
  bytes: number;
  /** Tools ChattyPop can install: the builds on offer, recommended first. Empty for models and off Windows. */
  builds: { build: ToolBuild; bytes: number }[];
  /** Which build ChattyPop installed; null for models, programs found on PATH, and when missing. */
  build: ToolBuild | null;
  state: InstallState;
  /** 0–1 while downloading. */
  progress: number | null;
  error: string | null;
  /** Tools only: installed by ChattyPop ('app') or found on PATH ('path'); null when missing. */
  source: 'app' | 'path' | null;
  /** Models only; null for tools. */
  score: ModelScore | null;
}

export interface TranscriptionStatus {
  /** ChattyPop installs the programs itself only on Windows; elsewhere they come from PATH. */
  canInstallTools: boolean;
  /** An NVIDIA GPU was found, so the GPU build of whisper.cpp is recommended. */
  gpu: boolean;
  tools: InstallItem[];
  models: InstallItem[];
  /** Both programs and the chosen model are in place. */
  ready: boolean;
}

/** queued → fetching (a pruned file is downloaded again to a temp file) → running → done | failed. */
export type TranscriptState = 'queued' | 'fetching' | 'running' | 'done' | 'failed';

export interface ArchiveTranscript {
  state: TranscriptState;
  text: string | null;
  /** Language whisper detected (ISO 639-1). */
  language: string | null;
  error: string | null;
}

/** Core asks main to download an attachment's audio to `path` (its file is not in the store); main answers with audioFetched. */
export interface TranscriptAudioRequest {
  /** Names this download in main's answer, so a report from an earlier request or core run is told apart. */
  requestId: number;
  attachmentId: string;
  messageId: string;
  channelId: string;
  url: string;
  path: string;
}
