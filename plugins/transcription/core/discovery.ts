import { SerialLoop } from '@plugin-sdk/core';
import { errorMessage } from '@plugin-sdk/shared';
import type { MediaSource } from './sources';

/** One small message page per helper snapshot bounds discovery results and cancellation latency. */
const DISCOVERY_BATCH = 16;
/** Retain recent negative discoveries so derived-text callbacks do not repeatedly requeue the same message. */
const RECENT_DISCOVERIES_MAX = 256;

/** Ingest only records ids; committed payload discovery starts on a later Core turn. */
export class MediaDiscovery {
  private readonly queued = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly waiting = new Map<string, MediaSource[]>();
  private readonly known = new Set<string>();
  private readonly loop = new SerialLoop(() => this.drain());
  private scheduled = false;

  constructor(private readonly signal: AbortSignal,
    private readonly read: (ids: string[]) => Promise<MediaSource[]>,
    private readonly apply: (id: string, sources: MediaSource[]) => void,
    private readonly covers: (source: MediaSource) => boolean,
    private readonly settled: (id: string) => void) {}

  shown(id: string): void {
    if (this.signal.aborted) return;
    this.pending.add(id); this.queued.add(id);
    if (this.scheduled || this.loop.busy) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (!this.signal.aborted) void this.loop.kick().catch((error) => {
        for (const id of this.queued) { this.remember(id); this.pending.delete(id); if (!this.signal.aborted) this.settled(id); }
        this.queued.clear();
        if (!this.signal.aborted) console.warn('[transcription] Discovery failed:', errorMessage(error));
      });
    });
  }

  due(id: string): boolean {
    return this.pending.has(id) || (this.waiting.get(id) ?? []).some(this.covers);
  }

  get busy(): boolean { return !this.signal.aborted && this.pending.size > 0; }
  has(id: string): boolean { return this.known.has(id) || this.pending.has(id); }

  private remember(id: string): void {
    this.known.delete(id); this.known.add(id);
    if (this.known.size > RECENT_DISCOVERIES_MAX) {
      const oldest = this.known.values().next().value!;
      this.known.delete(oldest); this.waiting.delete(oldest);
    }
  }

  private async drain(): Promise<void> {
    while (this.queued.size && !this.signal.aborted) {
      const ids = [...this.queued].slice(0, DISCOVERY_BATCH);
      for (const id of ids) this.queued.delete(id);
      let sources: MediaSource[];
      try { sources = await this.read(ids); }
      catch (error) {
        // A later change retries failed discovery; never leave derived-text waiters stuck.
        for (const id of ids) if (!this.queued.has(id)) { this.remember(id); this.pending.delete(id); if (!this.signal.aborted) this.settled(id); }
        throw error;
      }
      if (this.signal.aborted) return;
      for (const id of ids) {
        if (this.queued.has(id)) continue;
        const own = sources.filter((s) => s.messageId === id);
        const waiting = own.filter((s) => s.transcript === null && s.download === 'pending');
        if (waiting.length) this.waiting.set(id, waiting); else this.waiting.delete(id);
        this.remember(id);
        this.apply(id, own);
        this.pending.delete(id);
        this.settled(id);
      }
    }
  }
}
