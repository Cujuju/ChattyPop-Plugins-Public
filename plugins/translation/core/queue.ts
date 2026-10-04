// Translates queued parts one at a time (a local model takes the whole of what it uses), keeping each translation in
// step with its source text: a changed source is translated again, a gone one's translation cleared.
import { errorMessage, MS_PER_MIN } from '@plugin-sdk/shared';
import { MEANING_LOOKBACK_MS, SerialLoop, type PluginDb } from '@plugin-sdk/core';
import { SOURCE_KINDS, type SourceKind, type TranslatePick } from '../shared/types';
import type { PartSource } from './sources';
import { dropJobs, enqueue, fail, finish, jobTranslation, messageActive, messageJobs, nextJob, PRIORITY, queuedJobs, resetInterrupted, retryFailed, setState, type TranslationJob } from './store';

/** How soon the queue looks again at work left waiting for Settings' model to be able to run. */
const RETRY_MS = MS_PER_MIN;
/** Messages whose sources are read per archive read while catching up. */
const CATCH_UP_BATCH = 500;

/** The model chosen now: its name, and how it translates a text; or why it can't run. */
export type Translator = { name: string; translate(text: string, channelId: string, signal: AbortSignal): Promise<string | null> } | { unavailable: string };

/** A job ended. `text`: the derived text ('' clears an earlier translation); null: nothing to store. */
export type TranslationSettled =
  | { ok: true; messageId: string; seq: number; part: string; text: string | null; requestedAt: number; record: () => void }
  | { ok: false; messageId: string };

export interface QueueDeps {
  db: PluginDb;
  /** Each message's sources (sources.ts), its own translations left out. */
  sources(messageIds: readonly string[]): Map<string, PartSource[]>;
  /** The translator for a job: its pick, or Settings' model (null). */
  translator(pick: TranslatePick | null): Translator;
  /** Kinds Settings translates automatically. */
  auto(kind: SourceKind): boolean;
  events: {
    /** A job of the message changed state (its notes, the queue counts). */
    changed(messageId: string): void;
    settled(s: TranslationSettled): void;
  };
  lifetime: AbortSignal;
}

type Message = { channelId: string; ts: number };

export class TranslationQueue {
  private readonly loop = new SerialLoop(() => this.drain());
  private readonly stop = new AbortController();
  private readonly signal: AbortSignal;
  private retry: NodeJS.Timeout | null = null;

  constructor(private readonly d: QueueDeps) {
    this.signal = AbortSignal.any([this.stop.signal, d.lifetime]);
    resetInterrupted(d.db);
  }

  private message(messageId: string): Message | undefined {
    return this.d.db.prepare('SELECT channel_id AS channelId, ts FROM archive_all_messages WHERE id = ?').get(messageId) as Message | undefined;
  }

  /**
   * A source of the message may have arrived or changed (a plugin's text settled, the message was shown): a recent
   * message's sources of automatic kinds are queued; any message's translated parts follow their source. May run inside
   * ingest: writes only its own queue.
   */
  noted(messageId: string): void {
    const m = this.message(messageId);
    if (!m) return;
    const recent = m.ts >= Date.now() - MEANING_LOOKBACK_MS;
    const jobs = messageJobs(this.d.db, messageId);
    // Every stored message is shown: one with nothing to do isn't read further.
    if (!jobs.length && !(recent && SOURCE_KINDS.some((k) => this.d.auto(k)))) return;
    const sources = this.d.sources([messageId]).get(messageId) ?? [];
    const known = new Set(jobs.map((j) => j.partKey));
    const due = sources.filter((s) => known.has(s.key) || (recent && this.d.auto(s.kind)));
    this.forgetGone(messageId, jobs, new Set(sources.map((s) => s.key)));
    if (due.length && enqueue(this.d.db, messageId, m.channelId, due, PRIORITY.automatic, Date.now())) {
      this.d.events.changed(messageId);
      this.kick();
    }
  }

  /** Jobs of parts with no text now: waiting ones are dropped; a translation is cleared after the current work. */
  private forgetGone(messageId: string, jobs: ReturnType<typeof messageJobs>, shown: ReadonlySet<string>): void {
    const gone = jobs.filter((j) => !shown.has(j.partKey) && j.state !== 'running');
    if (!gone.length) return;
    const dropped = gone.filter((j) => !j.translation).map((j) => j.seq);
    if (dropped.length) dropJobs(this.d.db, dropped);
    for (const j of gone.filter((g) => g.translation)) {
      setImmediate(() => {
        // Its part may have text again by now (queued anew), or the job may have gone.
        if (this.signal.aborted || !this.stillGone(messageId, j.seq, j.partKey)) return;
        this.d.events.settled({ ok: true, messageId, seq: j.seq, part: j.partKey, text: '', requestedAt: j.requestedAt, record: () => dropJobs(this.d.db, [j.seq]) });
        this.d.events.changed(messageId);
      });
    }
    this.d.events.changed(messageId);
  }

  /** Whether job `seq` is still stored and its part still has no text. */
  private stillGone(messageId: string, seq: number, partKey: string): boolean {
    if (!messageJobs(this.d.db, messageId).some((j) => j.seq === seq)) return false;
    return !this.d.sources([messageId]).get(messageId)?.some((s) => s.key === partKey);
  }

  /** Queues the automatic kinds' sources of every message Jev still judges (its lookback): at start, and on Settings' change. */
  catchUp(): void {
    if (!SOURCE_KINDS.some((k) => this.d.auto(k))) return;
    const recent = this.d.db
      .prepare('SELECT id, channel_id AS channelId FROM archive_all_messages WHERE ts >= ? ORDER BY ts')
      .all(Date.now() - MEANING_LOOKBACK_MS) as { id: string; channelId: string }[];
    let queued = false;
    for (let i = 0; i < recent.length; i += CATCH_UP_BATCH) {
      const batch = recent.slice(i, i + CATCH_UP_BATCH);
      const sources = this.d.sources(batch.map((m) => m.id));
      for (const m of batch) {
        const due = (sources.get(m.id) ?? []).filter((s) => this.d.auto(s.kind));
        if (due.length && enqueue(this.d.db, m.id, m.channelId, due, PRIORITY.automatic, Date.now())) {
          this.d.events.changed(m.id);
          queued = true;
        }
      }
    }
    if (queued) this.kick();
  }

  /** The owner asked: every part of the message with text is translated again, however old, with `pick` or Settings' model (null). */
  request(messageId: string, pick: TranslatePick | null): void {
    const t = this.d.translator(pick);
    if ('unavailable' in t) throw new Error(t.unavailable);
    const m = this.message(messageId);
    const sources = m && this.d.sources([messageId]).get(messageId);
    if (!m || !sources) throw new Error('This message has no image text, transcript or link preview text to translate.');
    enqueue(this.d.db, messageId, m.channelId, sources, PRIORITY.requested, Date.now(), pick);
    this.d.events.changed(messageId);
    this.kick();
  }

  retryFailed(): void {
    for (const messageId of retryFailed(this.d.db, Date.now())) this.d.events.changed(messageId);
    this.kick();
  }

  /** A part of the message is queued or translating, and a model will translate it. */
  due(messageId: string): boolean {
    return messageActive(this.d.db, messageId, 'unavailable' in this.d.translator(null));
  }

  /** Runs the queue after the current work: a kick from inside ingest must not translate in its transaction. */
  kick(): void {
    if (this.signal.aborted) return;
    setImmediate(() => {
      if (!this.signal.aborted) this.loop.kick().catch((err: unknown) => console.warn('[translation] queue pass failed:', errorMessage(err)));
    });
  }

  /** Stops the queue (the plugin is turned off); an interrupted job is queued again on the next start. */
  dispose(): void {
    this.stop.abort();
    if (this.retry) clearTimeout(this.retry);
  }

  private retryLater(): void {
    this.retry ??= setTimeout(() => {
      this.retry = null;
      this.kick();
    }, RETRY_MS).unref();
  }

  private async drain(): Promise<void> {
    while (!this.signal.aborted) {
      const settings = this.d.translator(null);
      // Jobs for Settings' model stay queued until it can run: Settings' change kicks; a provider back on is seen on retry.
      const job = nextJob(this.d.db, 'unavailable' in settings);
      if (!job) break;
      const t = job.pick ? this.d.translator(job.pick) : settings;
      if ('unavailable' in t) {
        fail(this.d.db, job.seq, t.unavailable);
        this.d.events.changed(job.messageId);
        this.d.events.settled({ ok: false, messageId: job.messageId });
      } else await this.run(job, t);
    }
    if (!this.signal.aborted && queuedJobs(this.d.db)) this.retryLater();
  }

  private async run(job: TranslationJob, t: Exclude<Translator, { unavailable: string }>): Promise<void> {
    const source = this.d.sources([job.messageId]).get(job.messageId)?.find((s) => s.key === job.partKey);
    const before = jobTranslation(this.d.db, job.seq);
    if (!source) {
      // Its text went while it waited.
      const record = (): void => dropJobs(this.d.db, [job.seq]);
      this.d.events.settled({ ok: true, messageId: job.messageId, seq: job.seq, part: job.partKey, text: before ? '' : null, requestedAt: job.requestedAt, record });
      this.d.events.changed(job.messageId);
      return;
    }
    setState(this.d.db, job.seq, 'running');
    this.d.events.changed(job.messageId);
    try {
      this.signal.throwIfAborted();
      const translation = await t.translate(source.text, job.channelId, this.signal);
      // The source changed or went while it ran: its translation is never published; the job runs again on what is there now.
      const now = this.d.sources([job.messageId]).get(job.messageId)?.find((s) => s.key === job.partKey);
      if (now?.hash !== source.hash) {
        setState(this.d.db, job.seq, 'queued');
        this.d.events.changed(job.messageId);
        return;
      }
      const record = (): void => finish(this.d.db, job.seq, translation, source.hash, Date.now());
      // Already in the language: nothing to store, unless an earlier translation must be cleared.
      const text = translation ?? (before ? '' : null);
      this.d.events.settled({ ok: true, messageId: job.messageId, seq: job.seq, part: job.partKey, text, requestedAt: job.requestedAt, record });
    } catch (err) {
      if (this.signal.aborted) return; // turned off: queued again on the next start
      fail(this.d.db, job.seq, errorMessage(err));
      this.d.events.settled({ ok: false, messageId: job.messageId });
    }
    // Settling tells onSettled, which queues a source that changed after the check above (noted skips a running job).
    this.d.events.changed(job.messageId);
  }
}
