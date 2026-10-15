import { createSignal } from 'solid-js';
import { batchWrites } from '@plugin-sdk/renderer';
import type { AttachmentItem } from '../shared/types';

/** Selection is window-local; a reread replaces snapshots and drops rows no longer loaded. While `selecting`, a click picks. */
export function createSelection<T extends { id: string }>() {
  const [ids, setIds] = createSignal<ReadonlySet<string>>(new Set());
  const [selecting, setSelecting] = createSignal(false);
  const [items, setItems] = createSignal<T[]>([]);
  let anchor: string | null = null;
  const clear = (): void => { anchor = null; setIds(new Set<string>()); };
  /** Leaves select mode, dropping the picks. */
  const done = (): void => batchWrites(() => { clear(); setSelecting(false); });
  const retain = (loaded: readonly T[]): void => batchWrites(() => {
    setItems([...loaded]);
    const have = new Set(loaded.map((i) => i.id));
    setIds((old) => new Set([...old].filter((id) => have.has(id))));
    if (anchor !== null && !have.has(anchor)) anchor = null;
  });
  const toggle = (id: string, range = false): void => {
    const loaded = items();
    if (!loaded.some((i) => i.id === id)) return;
    const first = loaded.findIndex((i) => i.id === anchor);
    const last = loaded.findIndex((i) => i.id === id);
    setIds((old) => {
      const next = new Set(old);
      if (range && first >= 0) loaded.slice(Math.min(first, last), Math.max(first, last) + 1).forEach((i) => next.add(i.id));
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor = id;
    setSelecting(true);
  };
  return {
    ids, clear, done, retain, toggle, selecting,
    start: () => setSelecting(true),
    selected: () => items().filter((i) => ids().has(i.id)),
    selectAll: () => batchWrites(() => { setIds(new Set(items().map((i) => i.id))); setSelecting(true); }),
    drop: (gone: readonly string[]) => { const dropping = new Set(gone); setIds((old) => new Set([...old].filter((id) => !dropping.has(id)))); },
  };
}

export const selection = createSelection<AttachmentItem>();
export type AttachmentSelection = ReturnType<typeof createSelection<AttachmentItem>>;
export const selectedIds = selection.ids;
export const selectedItems = selection.selected;

export interface CompressionJob {
  total: number;
  done: number;
  current: string | null;
  fraction: number;
  savedBytes: number;
  skipped: number;
  compressed: number;
  running: boolean;
  cancelled: boolean;
}
export type CompressionResult = { kind: 'compressed'; savedBytes: number } | { kind: 'skipped'; reason: 'not-smaller' | 'unsupported' };
export type Compress<T> = (item: T, options: { signal: AbortSignal; onProgress(fraction: number): void }) => Promise<CompressionResult>;

/** One cancellable queue per window; failures end the queue and preserve its completed-work summary. */
export function createCompressionQueue<T extends { id: string }>() {
  const [job, setJob] = createSignal<CompressionJob | null>(null);
  let controller: AbortController | null = null;
  return {
    job,
    cancel: (): void => { controller?.abort(); },
    dismiss: (): void => { if (!job()?.running) setJob(null); },
    async run<U extends T>(items: readonly U[], compress: Compress<U>): Promise<void> {
      if (controller || !items.length) return;
      const run = new AbortController();
      controller = run;
      setJob({ total: items.length, done: 0, current: null, fraction: 0, savedBytes: 0, skipped: 0, compressed: 0, running: true, cancelled: false });
      try {
        for (const item of items) {
          if (run.signal.aborted) break;
          setJob((j) => ({ ...j!, current: item.id, fraction: 0 }));
          try {
            const result = await compress(item, {
              signal: run.signal,
              onProgress: (fraction) => setJob((j) => j?.running && j.current === item.id ? { ...j, fraction: Math.max(0, Math.min(1, fraction)) } : j),
            });
            setJob((j) => ({ ...j!, done: j!.done + 1, fraction: 1,
              savedBytes: j!.savedBytes + (result.kind === 'compressed' ? result.savedBytes : 0),
              compressed: j!.compressed + Number(result.kind === 'compressed'), skipped: j!.skipped + Number(result.kind === 'skipped') }));
          } catch (error) {
            if (!run.signal.aborted) throw error;
            break;
          }
        }
      } finally {
        controller = null;
        setJob((j) => ({ ...j!, running: false, current: null, cancelled: run.signal.aborted }));
      }
    },
  };
}

export const compression = createCompressionQueue<{ id: string }>();
export const compressionJob = compression.job;

/** Injectable deletion operation lets tests verify the request and selection changes without loading the UI kit. */
export async function freeSelection(items: readonly AttachmentItem[], free: (ids: readonly string[]) => Promise<{ freed: number; bytes: number }>): Promise<void> {
  await free(items.map((i) => i.id));
  selection.drop(items.map((i) => i.id));
}
