// Transcription in core: the toolchain, the queue, their settings and the calls Settings, the message menu and main make.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginDb, PluginFetch, ArchivePayloadReader } from '@plugin-sdk/core';
import type { TranscriptionCoreCalls } from '../shared';
import type { TranscriptionSettings, TranscriptionStatus } from '../shared/types';
import { Toolchain } from './toolchain';
import { Transcriber, type DownloadReports, type FetchBookkeeping, type TranscriberEvents, type TranscriptionSession } from './transcriber';

/** Per-job scratch files and re-downloaded audio; cleared at start (a quit mid-job leaves some). */
const WORK_DIR = 'work';

export interface Transcription {
  /** The calls Settings and the message menu make. */
  calls: Omit<TranscriptionCoreCalls, 'audioFetched'>;
  /** Main's download report (a completion report), writing through `done`. */
  audioFetched(requestId: number, error: string | null, done: FetchBookkeeping): void;
  /** An attachment reached the store. */
  attachmentStored(attachmentId: string): void;
  /** A transcript of the message is queued or running, or will be once its voice message's audio is stored. */
  due(messageId: string): boolean;
  /** Settings → Transcription was saved. */
  settingChanged(): void;
  /** The plugin is turned off: stops the queue and downloads. */
  dispose(): void;
}

export function setupTranscription(o: {
  db: PluginDb;
  payloads: ArchivePayloadReader;
  /** Programs, models and scratch files (the plugin's data folder). */
  toolsDir: string;
  /** Downloads programs and models (the context's net.fetch). */
  fetch: PluginFetch;
  attachmentsDir: string;
  /** Settings → Transcription (TranscriptionSettings, stored raw). `set` tells every window and runs settingChanged. */
  settings: { get(): TranscriptionSettings; set(value: TranscriptionSettings): void };
  /** Programs or models changed. */
  statusChanged: (status: TranscriptionStatus) => void;
  events: TranscriberEvents;
  session: TranscriptionSession;
  /** The activation's lifetime. */
  lifetime: AbortSignal;
  /** Downloads' audioFetched keys (completions). */
  reports: DownloadReports;
}): Transcription {
  const settings = (): TranscriptionSettings => o.settings.get();
  /**
   * Automatic transcription covers voice messages sent from when it was turned on, not the history before. Returns
   * whether it saved the stamp (a save of its own, which settingChanged hears).
   */
  const stampAutoSince = (): boolean => {
    const s = settings();
    if (!s.autoVoice || s.autoSince !== null) return false;
    o.settings.set({ ...s, autoSince: Date.now() });
    return true;
  };
  const workDir = join(o.toolsDir, WORK_DIR);
  // Once per core process: later activations keep audio main is still downloading into it.
  if (!o.session.workCleared) {
    o.session.workCleared = true;
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // A file still held (a program closing) is cleared at the next start.
    }
  }
  let disposed = false;
  const toolchain = new Toolchain(
    o.toolsDir,
    () => {
      if (disposed) return;
      o.statusChanged(toolchain.status(settings().model));
      transcriber.kick(); // a finished install may unblock queued jobs
    },
    o.fetch,
    o.session.installs,
  );
  const transcriber = new Transcriber(o.db, o.payloads, toolchain, settings, o.attachmentsDir, workDir, o.events, undefined, o.session, o.lifetime, o.reports);
  stampAutoSince();
  transcriber.kick(); // jobs a quit interrupted
  return {
    calls: {
      status: () => toolchain.status(settings().model),
      install: (id, build) => {
        // Replacing a program mid-transcript would fail on Windows (the file is in use).
        if (toolchain.status(null).tools.some((t) => t.id === id && t.source === 'app') && transcriber.busy) throw new Error('Wait for the transcript in progress to finish.');
        toolchain.install(id, build);
      },
      cancel: (id) => toolchain.cancel(id),
      deleteModel: (id) => toolchain.deleteModel(id),
      request: (attachmentId) => transcriber.request(attachmentId),
    },
    audioFetched: (requestId, error, done) => transcriber.audioFetched(requestId, error, done),
    attachmentStored: (id) => transcriber.attachmentStored(id),
    due: (messageId) => transcriber.due(messageId),
    settingChanged: () => {
      if (stampAutoSince()) return; // the stamp's own save runs the rest
      o.statusChanged(toolchain.status(settings().model));
      transcriber.kick();
    },
    dispose: () => {
      disposed = true;
      transcriber.dispose();
      toolchain.dispose();
    },
  };
}
