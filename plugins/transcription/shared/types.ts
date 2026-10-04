// Local speech-to-text (whisper.cpp + ffmpeg): settings, toolchain status and transcripts as core and renderer exchange them.
import { bool, isObj, textOrNull } from '@plugin-sdk/shared';

/** What can be transcribed automatically: voice messages, other audio files, video files, and videos embeds show. */
export const AUTO_KINDS = ['voice', 'audio', 'video', 'embedVideo'] as const;
export type AutoKind = (typeof AUTO_KINDS)[number];

export interface TranscriptionSettings {
  /** Per kind: new ones are transcribed once they reach ChattyPop (an attachment once its file is archived). */
  auto: Record<AutoKind, boolean>;
  /** Per kind: ones sent before this are only transcribed on request; core stamps it when the kind is first seen on. */
  since: Record<AutoKind, number | null>;
  /** Catalog id of the whisper model to use; null = none chosen. */
  model: string | null;
}

/** Voice messages only: whisper's time on audio files and videos is the owner's choice. */
export const DEFAULT_TRANSCRIPTION_SETTINGS: TranscriptionSettings = {
  auto: { voice: true, audio: false, video: false, embedVideo: false },
  since: { voice: null, audio: null, video: null, embedVideo: null },
  model: null,
};

const stamp = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Settings saved before per-kind switches had `autoVoice` and `autoSince` (voice messages): read as voice's. Saving
 * drops them, so a build before per-kind switches (a downgrade) reads automatic voice transcription as its default.
 */
export function normalizeTranscriptionSettings(v: unknown): TranscriptionSettings {
  const src = isObj(v) ? v : {};
  const auto = isObj(src['auto']) ? src['auto'] : { voice: src['autoVoice'] };
  const since = isObj(src['since']) ? src['since'] : { voice: src['autoSince'] };
  const d = DEFAULT_TRANSCRIPTION_SETTINGS;
  return {
    auto: Object.fromEntries(AUTO_KINDS.map((k) => [k, bool(auto[k], d.auto[k])])) as Record<AutoKind, boolean>,
    since: Object.fromEntries(AUTO_KINDS.map((k) => [k, stamp(since[k])])) as Record<AutoKind, number | null>,
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

/**
 * Core asks main to download a job's media to `path`: an attachment whose file is not in the store, or an embed's video
 * (Discord's media proxy). Main answers with audioFetched.
 */
export type TranscriptMediaRequest = {
  /** Names this download in main's answer, so a report from an earlier request or core run is told apart. */
  requestId: number;
  url: string;
  path: string;
} & ({ kind: 'attachment'; attachmentId: string; messageId: string; channelId: string } | { kind: 'embed' });
