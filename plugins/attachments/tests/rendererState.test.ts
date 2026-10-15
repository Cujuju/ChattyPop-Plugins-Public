import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { LARGEST, NEWEST, type AttachmentItem } from '../shared/types';
import { FILENAME_DEBOUNCE_MS, MIN_SIZE_OPTIONS, createAttachmentFilters } from '../renderer/filterState';
import { createCompressionQueue, createSelection, freeSelection, selection, type CompressionResult } from '../renderer/selection';

vi.mock('solid-js', async () => { const clientBuild = 'solid-js/dist/solid.cjs'; return import(clientBuild); });

const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

describe('attachment filters', () => {
  it('counts independent changed filters and restores every default in one reset', async () => {
    vi.useFakeTimers();
    const root = createRoot((dispose) => ({ f: createAttachmentFilters(), dispose }));
    try {
      const { f } = root;
      expect(f.filterCount()).toBe(0);
      f.setWhere({ by: 'guild', id: 'g1' }); f.setWho('alice'); f.setKinds(['image', 'video']); f.setRange('1y');
      f.setMinBytes(MIN_SIZE_OPTIONS[1]!.value); f.setPresence('gone'); f.setUncompressed(true); f.setName('budget'); f.setSort(LARGEST);
      expect(f.filterCount()).toBe(9);
      await vi.advanceTimersByTimeAsync(FILENAME_DEBOUNCE_MS);
      expect(f.filter()).toMatchObject({ guildId: 'g1', authorId: 'alice', kinds: ['image', 'video'], minBytes: MIN_SIZE_OPTIONS[1]!.value, name: 'budget', presence: 'gone', uncompressed: true });
      f.resetFilters();
      expect(f.filterCount()).toBe(0);
      expect(f.filter()).toEqual({ presence: 'stored', uncompressed: false });
      expect(f.sort()).toEqual(NEWEST);
      await vi.runAllTimersAsync();
      expect(f.filter()).toEqual({ presence: 'stored', uncompressed: false });
    } finally { root.dispose(); vi.useRealTimers(); }
  });

  it('debounces filename edits and scopes a channel separately from a server', async () => {
    vi.useFakeTimers();
    const root = createRoot((dispose) => ({ f: createAttachmentFilters(), dispose }));
    try {
      root.f.setWhere({ by: 'channel', id: 'c1' }); root.f.setName('old');
      await vi.advanceTimersByTimeAsync(FILENAME_DEBOUNCE_MS / 2);
      root.f.setName('  new%_  ');
      await vi.advanceTimersByTimeAsync(FILENAME_DEBOUNCE_MS / 2);
      expect(root.f.filter().name).toBeUndefined();
      await vi.advanceTimersByTimeAsync(FILENAME_DEBOUNCE_MS);
      expect(root.f.filter()).toEqual({ channelId: 'c1', name: 'new%_', presence: 'stored', uncompressed: false });
    } finally { root.dispose(); vi.useRealTimers(); }
  });
});

describe('selection', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  it('adds shift ranges in either direction and toggles individual rows', () => {
    const picks = createSelection<{ id: string }>();
    picks.retain(items);
    picks.toggle('b'); picks.toggle('d', true);
    expect([...picks.ids()]).toEqual(['b', 'c', 'd']);
    picks.toggle('a', true);
    expect(new Set(picks.ids())).toEqual(new Set(['a', 'b', 'c', 'd']));
    picks.toggle('c');
    expect(picks.selected().map((i) => i.id)).toEqual(['a', 'b', 'd']);
    picks.clear();
    expect(picks.ids().size).toBe(0);
  });
  it('selects all loaded, prunes dropped rows and updates selected snapshots on reload', () => {
    const picks = createSelection<{ id: string; bytes: number }>();
    picks.retain([{ id: 'a', bytes: 10 }, { id: 'b', bytes: 20 }]); picks.selectAll();
    picks.retain([{ id: 'b', bytes: 5 }, { id: 'c', bytes: 30 }]);
    expect(picks.selected()).toEqual([{ id: 'b', bytes: 5 }]);
    picks.drop(['b']);
    expect(picks.ids().size).toBe(0);
    picks.toggle('missing', true);
    expect(picks.ids().size).toBe(0);
  });
  it('injects the free function and drops selection only after a successful deletion', async () => {
    const item = { id: 'a' } as AttachmentItem;
    selection.retain([item]); selection.selectAll();
    const failed = vi.fn(async () => { throw new Error('disk'); });
    await expect(freeSelection([item], failed)).rejects.toThrow('disk');
    expect(selection.ids().has('a')).toBe(true);
    const free = vi.fn(async () => ({ freed: 1, bytes: 10 }));
    await freeSelection([item], free);
    expect(free).toHaveBeenCalledWith(['a']);
    expect(selection.ids().size).toBe(0);
  });
});

describe('compression queue', () => {
  it('runs sequentially, reports progress, accumulates savings and preserves a dismissible summary', async () => {
    const queue = createCompressionQueue<{ id: string }>();
    const pending: { id: string; answer(value: CompressionResult): void }[] = [];
    const run = queue.run([{ id: 'a' }, { id: 'b' }], (item, opts) => {
      opts.onProgress(0.5);
      return new Promise((answer) => pending.push({ id: item.id, answer }));
    });
    expect(pending.map((p) => p.id)).toEqual(['a']);
    expect(queue.job()).toMatchObject({ total: 2, current: 'a', fraction: 0.5, running: true });
    queue.dismiss();
    expect(queue.job()?.running).toBe(true);
    await queue.run([{ id: 'ignored' }], async () => ({ kind: 'compressed', savedBytes: 0 }));
    expect(pending).toHaveLength(1);
    pending[0]!.answer({ kind: 'compressed', savedBytes: 123 });
    await settle();
    expect(pending.map((p) => p.id)).toEqual(['a', 'b']);
    pending[1]!.answer({ kind: 'skipped', reason: 'not-smaller' });
    await run;
    expect(queue.job()).toMatchObject({ done: 2, current: null, savedBytes: 123, compressed: 1, skipped: 1, running: false, cancelled: false });
    queue.dismiss();
    expect(queue.job()).toBeNull();
  });
  it('aborts the running file and stops before starting the next one', async () => {
    const queue = createCompressionQueue<{ id: string }>();
    const calls: string[] = [];
    let signal: AbortSignal | undefined;
    const run = queue.run([{ id: 'a' }, { id: 'b' }], (item, options) => {
      calls.push(item.id); signal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    });
    queue.cancel();
    await run;
    expect(signal?.aborted).toBe(true);
    expect(calls).toEqual(['a']);
    expect(queue.job()).toMatchObject({ total: 2, done: 0, current: null, running: false, cancelled: true });
  });
  it('ends failed queues without continuing and can start another job', async () => {
    const queue = createCompressionQueue<{ id: string }>();
    const compress = vi.fn(async () => { throw new Error('encode'); });
    await expect(queue.run([{ id: 'a' }, { id: 'b' }], compress)).rejects.toThrow('encode');
    expect(compress).toHaveBeenCalledTimes(1);
    expect(queue.job()?.running).toBe(false);
    await queue.run([{ id: 'c' }], async () => ({ kind: 'compressed', savedBytes: 1 }));
    expect(queue.job()).toMatchObject({ done: 1, compressed: 1, savedBytes: 1 });
  });
});
