// Runs queued transcripts one at a time (whisper uses the whole GPU or every core), fetching media through main: pruned
// attachments, and embeds' videos.
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage, MS_PER_HOUR, MS_PER_MIN } from '@plugin-sdk/shared';
import { type PluginDb, SerialLoop, storedAttachmentPath } from '@plugin-sdk/core';
import { AUDIO_FETCHES_MAX } from '../shared';
import { AUTO_KINDS, type TranscriptMediaRequest, type TranscriptState, type TranscriptionSettings } from '../shared/types';
import { mediaSources, type MediaSource, type TranscriptionArchive } from './sources';
import { PRIORITY, attachmentMessage, enqueue, fail, finish, jobOf, nextJob, resetInterrupted, setState, transcriptKey, type TranscriptJob } from './store';
import type { Toolchain, ToolPaths } from './toolchain';
import { transcribe } from './whisper';

/** A stuck program must not hold the queue forever; far above whisper's time for an hour of audio on CPU (estimate). */
const JOB_TIMEOUT_MS = MS_PER_HOUR;
/**
 * How long main may take to report a download before its job fails, so one main never reports (it hung or crashed) can't
 * hold the job in 'fetching'. Assumption: an attachment or embed video (at most Discord's 500 MB upload) downloads well
 * within this on a slow link (about 4.5 Mbit/s).
 */
export const DOWNLOAD_REPORT_MAX_MS = 15 * MS_PER_MIN;
const DOWNLOAD_LATE = `no download finished within ${DOWNLOAD_REPORT_MAX_MS / MS_PER_MIN} minutes`;
export const NOT_SET_UP = 'Set up transcription first: Settings → Transcription.';
/** Transcript states still heading for done or failed. */
const ACTIVE_STATES: ReadonlySet<TranscriptState> = new Set(['queued', 'fetching', 'running']);
/** attachments.status before the file is downloaded, and once it is. */
const DOWNLOAD_PENDING = 'pending';
const DOWNLOAD_STORED = 'stored';

/**
 * A transcript job ended. `requestedAt`: when it was queued, i.e. when its audio reached ChattyPop; `seq`: its job's
 * place in the queue's history.
 */
export type TranscriptSettled =
  /**
   * `key`: the transcript's derived text key (transcriptKey); `part`: the part key it is of. `record`: stores the job's
   * result; runs in the same transaction as the host storing the text.
   */
  | { messageId: string; ok: true; key: string; part: string; seq: number; text: string; requestedAt: number; record: () => void }
  | { messageId: string; ok: false };

/** Where a download report writes: its finalizer's grant, or the running activation's own services. */
export interface FetchBookkeeping {
  db: PluginDb;
  /** The message's transcript won't come (derivedText.settle with none). */
  failed(messageId: string): void;
}

/** What the transcriber tells the rest of the app. */
export interface TranscriberEvents {
  /** A transcript of the message changed state (its attachment note). */
  changed(messageId: string): void;
  /** Main is to download a job's media; it answers with audioFetched. */
  fetchAudio(request: TranscriptMediaRequest): void;
  /** A transcript finished (`ok`: its message's text changed) or failed. */
  settled(s: TranscriptSettled): void;
}

/**
 * What lasts for the core process, so turning transcription off and on neither loses audio main is still downloading nor
 * clears the scratch folder under it.
 */
export interface TranscriptionSession {
  /**
   * Downloads asked of main and not reported, by request id (their audioFetched key): at most AUDIO_FETCHES_MAX, one per
   * job in the fetching state. Each fails at its deadline as if main reported DOWNLOAD_LATE.
   */
  readonly fetches: Map<number, { seq: number; deadline: NodeJS.Timeout }>;
  lastRequestId: number;
  /** The latest activation's transcriber: a download past its deadline is failed through it while it runs. */
  latest: Transcriber | null;
  /** The scratch folder was cleared (once, at the first activation: a quit mid-job leaves files). */
  workCleared: boolean;
  /** Each program's or model's install still running or cleaning up, so the next one waits for it. */
  readonly installs: Map<string, Promise<void>>;
}

export const newTranscriptionSession = (): TranscriptionSession => ({ fetches: new Map(), lastRequestId: 0, latest: null, workCleared: false, installs: new Map() });

/** A download's completion report key (ctx.completions for audioFetched). */
export interface DownloadReports {
  /** Asks main through `send` under the request's key; false, running nothing, while the report's declared max are out. */
  dispatch(requestId: number, send: () => void): boolean;
  withdraw(requestId: number): void;
}

export class Transcriber {
  private readonly loop = new SerialLoop(() => this.drain());
  /** Aborted when the plugin is turned off: the running job stops, and nothing more starts. */
  private readonly stop = new AbortController();
  /** `stop` or the activation's lifetime: work after an await stops once either ends. */
  private readonly signal: AbortSignal;

  constructor(
    private readonly db: PluginDb,
    private readonly archive: TranscriptionArchive,
    private readonly toolchain: Toolchain,
    private readonly settings: () => TranscriptionSettings,
    private readonly attachmentsDir: string,
    /** Scratch space: media main fetched, and per-job WAV/JSON. */
    private readonly workDir: string,
    private readonly events: TranscriberEvents,
    private readonly runJob: typeof transcribe = transcribe,
    private readonly session: TranscriptionSession = newTranscriptionSession(),
    lifetime?: AbortSignal,
    /** A download's audioFetched key (completions): issued before main is asked, withdrawn once its deadline gives up. */
    private readonly reports: DownloadReports = { dispatch: (_, send) => (send(), true), withdraw: () => undefined },
  ) {
    this.signal = lifetime ? AbortSignal.any([this.stop.signal, lifetime]) : this.stop.signal;
    resetInterrupted(db, [...session.fetches.values()].map((f) => f.seq));
    session.latest = this;
  }

  /** An attachment was stored: queues what automatic transcription covers of its message. */
  attachmentStored(attachmentId: string): void {
    const messageId = attachmentMessage(this.db, attachmentId);
    if (messageId && this.queueAutomatic(messageId)) this.kick();
  }

  /** A message was stored or updated (embeds arrive by edit). Runs inside ingest: only queues; the queue runs after. */
  shown(messageId: string): void {
    if (this.queueAutomatic(messageId)) setImmediate(() => this.kick());
  }

  /** Queues the message's parts automatic transcription covers and that can run now; returns whether any was queued. */
  private queueAutomatic(messageId: string): boolean {
    const auto = this.settings().auto;
    if (!AUTO_KINDS.some((k) => auto[k])) return false; // every message stored runs this: skip reading its parts
    const due =this.sources(messageId).filter((s) => s.transcript === null && this.autoCovers(s) && (s.download === null || s.download === DOWNLOAD_STORED));
    const queued = due.filter((s) => enqueue(this.db, s, PRIORITY.automatic, Date.now())).length > 0;
    if (queued) this.changed(messageId);
    return queued;
  }

  /** A transcript of the message is queued or running, or will be queued once an attachment's file is stored. */
  due(messageId: string): boolean {
    return this.sources(messageId).some(
      (s) => (s.transcript !== null && ACTIVE_STATES.has(s.transcript)) || (s.transcript === null && s.download === DOWNLOAD_PENDING && this.autoCovers(s)),
    );
  }

  private sources(messageId: string): MediaSource[] {
    return mediaSources(this.db, this.archive, [messageId]);
  }

  /** Automatic transcription is set up and covers this part: its kind is on, and it was sent since. */
  private autoCovers(s: MediaSource): boolean {
    const settings = this.settings();
    const since = settings.since[s.auto];
    return settings.auto[s.auto] && since !== null && s.ts >= since && !!this.toolchain.ready(settings.model);
  }

  /** The owner asked for transcripts of the message's audio and video (`part`, or each one; however old). */
  request(messageId: string, part: string | null): void {
    if (!this.toolchain.ready(this.settings().model)) throw new Error(NOT_SET_UP);
    const sources = this.sources(messageId).filter((s) => part === null || s.partKey === part);
    if (!sources.length) throw new Error(part === null ? 'This message has no audio or video.' : 'Not audio or video of this message.');
    if (sources.filter((s) => enqueue(this.db, s, PRIORITY.requested, Date.now())).length) this.changed(messageId);
    this.kick();
  }

  /** Where main writes a job's media when its file isn't in the store. */
  fetchedPath(seq: number): string {
    return join(this.workDir, `${seq}.media`);
  }

  /**
   * Main's answer to fetchAudio request `requestId` (its completion report, also while the plugin is off, writing through
   * `done`), or its deadline: only a request this session made and hasn't failed at its deadline counts, and only for a
   * job still waiting for it.
   */
  audioFetched(requestId: number, error: string | null, done: FetchBookkeeping = { db: this.db, failed: (messageId) => this.events.settled({ messageId, ok: false }) }): void {
    const asked = this.session.fetches.get(requestId);
    if (asked === undefined) return;
    clearTimeout(asked.deadline);
    this.session.fetches.delete(requestId);
    this.reports.withdraw(requestId); // a report after its deadline counts for nothing (reported: already gone)
    const { seq } = asked;
    const job = jobOf(done.db, seq);
    if (job?.state !== 'fetching') return;
    const { messageId } = job;
    if (error) fail(done.db, seq, `It could not be downloaded: ${error}`);
    else setState(done.db, seq, 'queued');
    this.changed(messageId);
    if (error) done.failed(messageId);
    this.kick();
  }

  /**
   * A download main hasn't reported by its deadline: failed through this activation while it runs. Off, nothing may
   * write, so its job stays fetching and the next activation queues it again (resetInterrupted).
   */
  private fetchLate(requestId: number): void {
    if (!this.signal.aborted) return this.audioFetched(requestId, DOWNLOAD_LATE);
    this.session.fetches.delete(requestId);
    this.reports.withdraw(requestId);
  }

  /** A transcript is being made (its programs are in use). */
  get busy(): boolean {
    return this.loop.busy;
  }

  /** Safe to call often; coalesces into one drain loop. */
  kick(): void {
    if (!this.signal.aborted) void this.loop.kick();
  }

  /** Stops the queue (the plugin is turned off). A job it interrupts is queued again on the next start (resetInterrupted). */
  dispose(): void {
    this.stop.abort();
  }

  private async drain(): Promise<void> {
    for (let job = nextJob(this.db); job && !this.signal.aborted; job = nextJob(this.db)) {
      const model = this.settings().model;
      const ready = this.toolchain.ready(model);
      if (!ready || !model) return; // stays queued until setup completes (install kicks the queue)
      if (!(await this.run(job, { ...ready, id: model }))) return; // waits for a download's report, which kicks the queue
    }
  }

  /** Runs `job`, or asks main for its media; false when that would pass AUDIO_FETCHES_MAX, leaving it queued. */
  private async run(job: TranscriptJob, ready: { tools: ToolPaths; model: string; id: string }): Promise<boolean> {
    const stored = job.sha256 && job.filename ? storedAttachmentPath(this.attachmentsDir, job.sha256, job.filename) : null;
    const fetched = this.fetchedPath(job.seq);
    const input = stored && existsSync(stored) ? stored : existsSync(fetched) ? fetched : null;
    if (!input) {
      if (this.session.fetches.size >= AUDIO_FETCHES_MAX) return false;
      // An embed's video, or an attachment pruned, failed or not yet downloaded: main fetches it through the Discord
      // session; the store's cap is left alone.
      await mkdir(this.workDir, { recursive: true });
      if (this.signal.aborted) return true; // a later activation owns the job now
      const requestId = ++this.session.lastRequestId;
      const asked = this.reports.dispatch(requestId, () => {
        setState(this.db, job.seq, 'fetching');
        // Unreported by then: failed through the activation running at that time.
        const deadline = setTimeout(() => (this.session.latest ?? this).fetchLate(requestId), DOWNLOAD_REPORT_MAX_MS).unref(); // never holds core open
        this.session.fetches.set(requestId, { seq: job.seq, deadline });
        const at = { requestId, url: job.url, path: fetched };
        this.events.fetchAudio(
          job.attachmentId ? { ...at, kind: 'attachment', attachmentId: job.attachmentId, messageId: job.messageId, channelId: job.channelId } : { ...at, kind: 'embed' },
        );
      });
      if (!asked) return false; // the report's max are out: waits for one, as at AUDIO_FETCHES_MAX
      this.changed(job.messageId);
      return true;
    }
    setState(this.db, job.seq, 'running');
    this.changed(job.messageId);
    try {
      await mkdir(this.workDir, { recursive: true });
      this.signal.throwIfAborted();
      const r = await this.runJob(ready.tools, ready.model, input, this.workDir, AbortSignal.any([AbortSignal.timeout(JOB_TIMEOUT_MS), this.signal]));
      const record = (): void => finish(this.db, job.seq, r, ready.id, Date.now());
      this.events.settled({ messageId: job.messageId, ok: true, key: transcriptKey(job), part: job.partKey, seq: job.seq, text: r.text, requestedAt: job.requestedAt, record });
    } catch (err) {
      if (this.signal.aborted) return true; // turned off: left running, queued again on the next start
      fail(this.db, job.seq, errorMessage(err));
      this.events.settled({ messageId: job.messageId, ok: false });
    } finally {
      // Turned off: fetched audio stays for the next activation's run of the job.
      if (!this.signal.aborted) await rm(fetched, { force: true });
    }
    this.changed(job.messageId);
    return true;
  }

  private changed(messageId: string): void {
    this.events.changed(messageId);
  }
}
