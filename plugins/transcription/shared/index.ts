// Local whisper.cpp/ffmpeg transcription. Derived transcripts feed rules, Jev, summaries, search, and Autopost's {transcript}.
import { defineChannels, definePlugin, definePreference } from '@plugin-sdk/shared';
import { decodeInstall, decodeItem, decodeNoArgs, decodeRequest } from './calls';
import { DEFAULT_TRANSCRIPTION_SETTINGS, normalizeTranscriptionSettings, type ToolBuild, type TranscriptMediaRequest, type TranscriptionStatus } from './types';
import { transcribed } from './rules';

export const manifest = {
  id: 'transcription',
  name: 'Transcription',
  version: '1.2.2',
  description: 'Turns voice messages, audio and video into text on this computer, for rules, Jev, summaries and search.',
};

/** Settings tab id. */
export const TRANSCRIPTION_TAB = 'transcription' as const;
/** Plugin event: programs or models changed (a download started, progressed or ended); payload TranscriptionStatus. */
export const STATUS_EVENT = 'status' as const;
/** Core → main: download a job's media (TranscriptMediaRequest); main answers with audioFetched. */
export const FETCH_AUDIO = 'fetchAudio' as const;
/** AttachmentNote.kind of a transcript. */
export const TRANSCRIPT_NOTE = 'transcript';
/** Maximum concurrent main-process audio downloads. Further jobs wait for completion reports. */
export const AUDIO_FETCHES_MAX = 4;

/** Core's calls: from Settings and the message menu, and main's answer to FETCH_AUDIO. */
export interface TranscriptionCoreCalls {
  /** Programs, models and whether transcription can run. */
  status(): TranscriptionStatus;
  /** Installs a program/model by ID and emits progress. build selects a replacement; null uses the recommendation. Throws during transcription. */
  install(id: string, build: ToolBuild | null): void;
  cancel(id: string): void;
  deleteModel(id: string): Promise<void>;
  /** Prioritizes requested audio/video parts. Null selects all unfinished parts. Throws when transcription is unavailable or the part is absent. */
  request(messageId: string, part: string | null): void;
  /** Main's answer to FETCH_AUDIO `requestId`: the audio is at the requested path, or `error`. */
  audioFetched(requestId: number, error: string | null): void;
}

export interface TranscriptionEvents {
  [STATUS_EVENT]: TranscriptionStatus;
  [FETCH_AUDIO]: TranscriptMediaRequest;
}

export const plugin = definePlugin({
  manifest,
  // The phone's message menu shows whether transcription is set up, as it did before this was a plugin.
  channels: defineChannels<{ core: TranscriptionCoreCalls; events: TranscriptionEvents }>()({
    core: {
      status: { audiences: ['renderer', 'phone'], writes: false, decode: decodeNoArgs },
      install: { audiences: ['renderer', 'phone'], writes: true, decode: decodeInstall },
      cancel: { audiences: ['renderer', 'phone'], writes: true, decode: decodeItem },
      deleteModel: { audiences: ['renderer', 'phone'], writes: true, decode: decodeItem },
      request: { audiences: ['renderer', 'phone'], writes: true, decode: decodeRequest },
      audioFetched: { audiences: ['main'], completion: { max: AUDIO_FETCHES_MAX } },
    },
    events: { [STATUS_EVENT]: ['renderer', 'phone'], [FETCH_AUDIO]: ['main'] },
  }),
  settings: [
    // A microphone: its capsule (a rounded 6 × 11 rect at 9, 3), its stand's arc and foot.
    { id: TRANSCRIPTION_TAB, label: 'Transcription', tab: { after: 'imagetext', iconPath: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3' } },
  ],
  // Pinned programs and models (core/catalog.ts): Hugging Face and GitHub releases, and the CDNs they redirect to.
  network: { hosts: ['huggingface.co', 'hf.co', 'github.com', 'githubusercontent.com'] },
  /** Settings → Transcription. */
  preferences: { settings: definePreference({ default: DEFAULT_TRANSCRIPTION_SETTINGS, normalize: normalizeTranscriptionSettings }) },
  slots: { messageMenu: [{ id: 'transcribe', after: 'copy' }] },
  rules: { filters: [transcribed] },
  // Its queue's table, settings and downloads' folder from when it was built in.
  adopts: { tables: { transcripts: 'jobs' }, settings: { transcription: 'settings' }, dataDir: 'transcription' },
});
export default plugin;
