// Reads queued images one at a time (the OCR worker and a local vision model each take the whole of what they use),
// fetching through main the images the store doesn't hold.
import { existsSync, rmSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage, MS_PER_MIN } from '@plugin-sdk/shared';
import { MEANING_LOOKBACK_MS, SerialLoop, storedAttachmentPath, type MessageImage, type PluginDb } from '@plugin-sdk/core';
import { IMAGE_FETCHES_MAX } from '../shared';
import type { EnginePick, ImageFetchRequest } from '../shared/types';
import { imageText } from './chartTickers';
import { dropJobs, enqueue, fail, finish, jobOf, jobText, messageActive, messageJobs, nextJob, PRIORITY, queuedJobs, resetInterrupted, retryFailed, setState, type ImageJob } from './store';

/** How long main may take to report a download before its job fails. Assumption: an image downloads well within it. */
export const DOWNLOAD_REPORT_MAX_MS = 5 * MS_PER_MIN;
const DOWNLOAD_LATE = `no download finished within ${DOWNLOAD_REPORT_MAX_MS / MS_PER_MIN} minutes`;
/**
 * How long a job waits for the store to download its attachment before main fetches the image itself (a download that
 * failed, was evicted, or hangs). Assumption: the store downloads a new attachment well within it.
 */
export const ATTACHMENT_STORE_WAIT_MS = 2 * MS_PER_MIN;
/** How soon the queue looks again at work it left waiting: an attachment download, or an engine that can't run yet. */
const RETRY_MS = MS_PER_MIN;
/** Messages whose images are read per archive read while catching up. */
const CATCH_UP_BATCH = 500;
/** attachments.status once the file is in the store. */
const STORED = 'stored';

/** What an engine read: the image's text, and the tickers it shows when it is a chart or trading screen. */
export interface Reading {
  text: string;
  tickers: string[];
}

/** The engine chosen now: its name for the record, and how it reads a file; or why it can't run. */
export type Engine = { name: string; read(path: string, channelId: string, signal: AbortSignal): Promise<Reading> } | { unavailable: string };

/** A job ended. `text`: the derived text ('' clears an earlier reading's); null: nothing to store (no text, never any). */
export type ImageSettled =
  | { ok: true; messageId: string; seq: number; text: string | null; requestedAt: number; record: () => void }
  | { ok: false; messageId: string };

/** Where a download report writes: its finalizer's grant, or the running activation's own services. */
export interface FetchBookkeeping {
  db: PluginDb;
  /** The message's image text won't come (derivedText.settle with none). */
  failed(messageId: string): void;
}

export interface ReaderEvents {
  /** A job of the message changed state (its attachment note, the queue counts). */
  changed(messageId: string): void;
  /** Main is to download an image the store doesn't hold; it answers with imageFetched. */
  fetchImage(request: ImageFetchRequest): void;
  settled(s: ImageSettled): void;
}

/** What lasts for the core process: downloads main is making outlive turning the plugin off and on. */
export interface ImageTextSession {
  /** Downloads asked of main and not reported, by request id (their imageFetched key): the job, its file, its deadline. */
  readonly fetches: Map<number, { seq: number; path: string; deadline: NodeJS.Timeout }>;
  /** Images main downloaded, by job, until the job reads them. */
  readonly fetched: Map<number, string>;
  /** Files of downloads failed at their deadline, by request id: removed if main writes one after all. */
  readonly expired: Map<number, string>;
  lastRequestId: number;
  /** The latest activation's reader: a download past its deadline is failed through it while it runs. */
  latest: ImageReader | null;
  /** The scratch folder was cleared (once, at the first activation: a quit mid-download leaves files). */
  workCleared: boolean;
}

export const newImageTextSession = (): ImageTextSession => ({ fetches: new Map(), fetched: new Map(), expired: new Map(), lastRequestId: 0, latest: null, workCleared: false });

export interface DownloadReports {
  /** Asks main through `send` under the request's key; false, running nothing, while the report's declared max are out. */
  dispatch(requestId: number, send: () => void): boolean;
  withdraw(requestId: number): void;
}

export interface ReaderDeps {
  db: PluginDb;
  /** ctx.archive.images.of */
  images(messageIds: readonly string[]): Map<string, MessageImage[]>;
  /** The engine for a job: pick, or Settings' engine (null). */
  engine(pick: EnginePick | null): Engine;
  /** Settings → Image text's automatic reading. */
  auto(): boolean;
  attachmentsDir: string;
  /** Scratch space: images main downloaded. */
  workDir: string;
  events: ReaderEvents;
  session: ImageTextSession;
  lifetime: AbortSignal;
  reports: DownloadReports;
}

export class ImageReader {
  private readonly loop = new SerialLoop(() => this.drain());
  private readonly stop = new AbortController();
  private readonly signal: AbortSignal;
  private retry: NodeJS.Timeout | null = null;

  constructor(private readonly d: ReaderDeps) {
    this.signal = AbortSignal.any([this.stop.signal, d.lifetime]);
    if (!d.session.workCleared) {
      d.session.workCleared = true;
      rmSync(d.workDir, { recursive: true, force: true });
    }
    resetInterrupted(d.db, [...d.session.fetches.values()].map((f) => f.seq));
    d.session.latest = this;
  }

  /**
   * A message was stored or updated, or its links gained images: when reading is automatic, a recent one's new images
   * are queued and the text of images it no longer shows is cleared. Runs inside ingest: writes only its own queue.
   */
  shown(messageId: string): void {
    if (!this.d.auto()) return;
    const m = this.d.db.prepare('SELECT channel_id AS channelId, ts FROM archive_all_messages WHERE id = ?').get(messageId) as { channelId: string; ts: number } | undefined;
    if (!m || m.ts < Date.now() - MEANING_LOOKBACK_MS) return;
    const images = this.d.images([messageId]).get(messageId) ?? [];
    this.forgetGone(messageId, new Set(images.map((i) => i.key)));
    if (this.queue(messageId, m.channelId, images, PRIORITY.automatic, false)) this.kick();
  }

  /**
   * Jobs of images the message no longer shows (a preview removed or replaced): waiting ones are dropped; the text of
   * read ones is cleared after the ingest that found it, so matching runs outside its transaction.
   */
  private forgetGone(messageId: string, shown: ReadonlySet<string>): void {
    const gone = messageJobs(this.d.db, messageId).filter((j) => !shown.has(j.imageKey) && j.state !== 'fetching' && j.state !== 'running');
    if (!gone.length) return;
    const dropped = gone.filter((j) => !j.text).map((j) => j.seq);
    if (dropped.length) dropJobs(this.d.db, dropped);
    for (const j of gone.filter((g) => g.text)) {
      setImmediate(() => {
        if (this.signal.aborted) return;
        this.d.events.settled({ ok: true, messageId, seq: j.seq, text: '', requestedAt: j.requestedAt, record: () => dropJobs(this.d.db, [j.seq]) });
      });
    }
    this.d.events.changed(messageId);
  }

  /** Queues the images of every message Jev still judges (its lookback) not yet read: at start, and when reading turns automatic. */
  catchUp(): void {
    if (!this.d.auto()) return;
    const recent = this.d.db
      .prepare('SELECT id, channel_id AS channelId FROM archive_all_messages WHERE ts >= ? ORDER BY ts')
      .all(Date.now() - MEANING_LOOKBACK_MS) as { id: string; channelId: string }[];
    let queued = false;
    for (let i = 0; i < recent.length; i += CATCH_UP_BATCH) {
      const batch = recent.slice(i, i + CATCH_UP_BATCH);
      const images = this.d.images(batch.map((m) => m.id));
      for (const m of batch) {
        const list = images.get(m.id);
        if (list && this.queue(m.id, m.channelId, list, PRIORITY.automatic, false)) queued = true;
      }
    }
    if (queued) this.kick();
  }

  /** The owner asked: every image of the message is read again, however old, with pick or Settings' engine (null). */
  request(messageId: string, pick: EnginePick | null): void {
    const engine = this.d.engine(pick);
    if ('unavailable' in engine) throw new Error(engine.unavailable);
    const m = this.d.db.prepare('SELECT channel_id AS channelId FROM archive_all_messages WHERE id = ?').get(messageId) as { channelId: string } | undefined;
    const images = m && this.d.images([messageId]).get(messageId);
    if (!m || !images) throw new Error('This message shows no images.');
    this.queue(messageId, m.channelId, images, PRIORITY.requested, true, pick);
    this.kick();
  }

  retryFailed(): void {
    for (const messageId of retryFailed(this.d.db, Date.now())) this.d.events.changed(messageId);
    this.kick();
  }

  /**
   * An image of the message is queued or being read, and an engine will read it: a queue no engine drains never holds a
   * message's text as still coming. A picked engine that can't run fails its job, so that job is always due.
   */
  due(messageId: string): boolean {
    return messageActive(this.d.db, messageId, !this.ready());
  }

  /** Settings' engine can run. */
  private ready(): boolean {
    return !('unavailable' in this.d.engine(null));
  }

  /**
   * Main's answer to fetchImage `requestId` (its completion report, also while the plugin is off, writing through
   * `done`), or its deadline: counts only for a request this session made and a job still waiting for it.
   */
  imageFetched(requestId: number, error: string | null, done: FetchBookkeeping = { db: this.d.db, failed: (messageId) => this.d.events.settled({ ok: false, messageId }) }): void {
    const late = this.d.session.expired.get(requestId);
    if (late !== undefined) {
      this.d.session.expired.delete(requestId);
      rmSync(late, { force: true }); // written after its job gave up on it
      return;
    }
    const asked = this.d.session.fetches.get(requestId);
    if (!asked) return;
    clearTimeout(asked.deadline);
    this.d.session.fetches.delete(requestId);
    this.d.reports.withdraw(requestId);
    const job = jobOf(done.db, asked.seq);
    if (!job || job.state !== 'fetching') return void rmSync(asked.path, { force: true });
    if (error) fail(done.db, asked.seq, `The image could not be downloaded: ${error}`);
    else {
      this.d.session.fetched.set(asked.seq, asked.path);
      setState(done.db, asked.seq, 'queued');
    }
    this.d.events.changed(job.messageId);
    if (error) done.failed(job.messageId);
    this.kick();
  }

  /** A download main hasn't reported by its deadline, failed through this activation while it runs. */
  private fetchLate(requestId: number): void {
    const asked = this.d.session.fetches.get(requestId);
    if (!asked) return;
    if (!this.signal.aborted) this.imageFetched(requestId, DOWNLOAD_LATE);
    else {
      this.d.session.fetches.delete(requestId);
      this.d.reports.withdraw(requestId);
    }
    this.d.session.expired.set(requestId, asked.path); // main may still write it
  }

  /** Runs the queue after the current work: a kick from inside ingest must not read images in its transaction. */
  kick(): void {
    if (this.signal.aborted) return;
    setImmediate(() => {
      if (!this.signal.aborted) this.loop.kick().catch((err: unknown) => console.warn('[imagetext] queue pass failed:', errorMessage(err)));
    });
  }

  /** Stops the queue (the plugin is turned off); an interrupted job is queued again on the next start. */
  dispose(): void {
    this.stop.abort();
    if (this.retry) clearTimeout(this.retry);
  }

  /** Looks at the queue again in RETRY_MS: work was left waiting for a download or an engine. */
  private retryLater(): void {
    this.retry ??= setTimeout(() => {
      this.retry = null;
      this.kick();
    }, RETRY_MS).unref();
  }

  /** Queues `images` of the message; `again` re-reads those already read, with `pick`. Returns whether any was queued. */
  private queue(messageId: string, channelId: string, images: readonly MessageImage[], priority: number, again: boolean, pick: EnginePick | null = null): boolean {
    const known = again ? null : new Set(messageJobs(this.d.db, messageId).map((j) => j.imageKey));
    const fresh = known ? images.filter((i) => !known.has(i.key)) : images;
    if (!fresh.length || !enqueue(this.d.db, messageId, channelId, fresh, priority, Date.now(), again, pick)) return false;
    this.d.events.changed(messageId);
    return true;
  }

  private async drain(): Promise<void> {
    while (!this.signal.aborted) {
      const settings = this.d.engine(null);
      // Jobs for Settings' engine stay queued until it can run: Settings' change kicks; a provider back on is seen on retry.
      const job = nextJob(this.d.db, Date.now() - ATTACHMENT_STORE_WAIT_MS, 'unavailable' in settings);
      if (!job) break;
      const engine = job.pick ? this.d.engine(job.pick) : settings;
      // A picked engine that can't run fails its job: the pick was the owner's, made once.
      if ('unavailable' in engine) this.abandon(job, engine.unavailable);
      else if (!(await this.run(job, engine))) return; // waits for a download's report, which kicks the queue
    }
    // Jobs waiting on the store's downloads, or on Settings' engine.
    if (!this.signal.aborted && queuedJobs(this.d.db)) this.retryLater();
  }

  /** Fails a queued job without reading it, removing any image main downloaded for it. */
  private abandon(job: ImageJob, error: string): void {
    fail(this.d.db, job.seq, error);
    const fetched = this.d.session.fetched.get(job.seq);
    if (fetched) {
      this.d.session.fetched.delete(job.seq);
      rmSync(fetched, { force: true });
    }
    this.d.events.changed(job.messageId);
    this.d.events.settled({ ok: false, messageId: job.messageId });
  }

  /** The image's file: in the store, or downloaded by main earlier; null when main must fetch it. */
  private input(job: ImageJob): string | null {
    if (job.attachmentId) {
      const a = this.d.db.prepare('SELECT sha256, filename, status FROM archive_all_attachments WHERE id = ?').get(job.attachmentId) as { sha256: string | null; filename: string; status: string } | undefined;
      const stored = a?.status === STORED && a.sha256 ? storedAttachmentPath(this.d.attachmentsDir, a.sha256, a.filename) : null;
      if (stored && existsSync(stored)) return stored;
    }
    const fetched = this.d.session.fetched.get(job.seq);
    return fetched && existsSync(fetched) ? fetched : null;
  }

  /** Runs `job`, or asks main for its image; false when that would pass IMAGE_FETCHES_MAX, leaving it queued. */
  private async run(job: ImageJob, engine: Exclude<Engine, { unavailable: string }>): Promise<boolean> {
    const input = this.input(job);
    if (!input) {
      if (this.d.session.fetches.size >= IMAGE_FETCHES_MAX) return false;
      await mkdir(this.d.workDir, { recursive: true });
      if (this.signal.aborted) return true;
      const requestId = ++this.d.session.lastRequestId;
      // Its own file per request: a late report of an earlier request can't touch a retry's.
      const fetched = join(this.d.workDir, `${job.seq}-${requestId}.image`);
      const asked = this.d.reports.dispatch(requestId, () => {
        setState(this.d.db, job.seq, 'fetching');
        const deadline = setTimeout(() => (this.d.session.latest ?? this).fetchLate(requestId), DOWNLOAD_REPORT_MAX_MS).unref();
        this.d.session.fetches.set(requestId, { seq: job.seq, path: fetched, deadline });
        this.d.events.fetchImage(
          job.attachmentId
            ? { requestId, url: job.url, path: fetched, kind: 'attachment', attachmentId: job.attachmentId, messageId: job.messageId, channelId: job.channelId }
            : { requestId, url: job.url, path: fetched, kind: 'shown' },
        );
      });
      if (!asked) return false;
      this.d.events.changed(job.messageId);
      return true;
    }
    const before = jobText(this.d.db, job.seq);
    setState(this.d.db, job.seq, 'running');
    this.d.events.changed(job.messageId);
    try {
      this.signal.throwIfAborted();
      const r = await engine.read(input, job.channelId, this.signal);
      const text = imageText(r.text, r.tickers);
      const record = (): void => finish(this.d.db, job.seq, engine.name, text, Date.now());
      // No text: nothing to store, unless an earlier reading's text must be cleared.
      const derived = text || (before ? '' : null);
      this.d.events.settled({ ok: true, messageId: job.messageId, seq: job.seq, text: derived, requestedAt: job.requestedAt, record });
    } catch (err) {
      if (this.signal.aborted) return true; // turned off: queued again on the next start
      fail(this.d.db, job.seq, errorMessage(err));
      this.d.events.settled({ ok: false, messageId: job.messageId });
    } finally {
      // Turned off: a downloaded image stays for the next activation's run of the job.
      const fetched = this.d.session.fetched.get(job.seq);
      if (!this.signal.aborted && fetched) {
        this.d.session.fetched.delete(job.seq);
        await rm(fetched, { force: true });
      }
    }
    this.d.events.changed(job.messageId);
    return true;
  }
}
