import { describe, expect, it, vi } from 'vitest';
import type { AttachmentItem } from '../shared/types';
import { moveTo } from '../renderer/movement';

vi.mock('solid-js', async () => { const clientBuild = 'solid-js/dist/solid.cjs'; return import(clientBuild); });

type Direction = -1 | 1;
interface LightboxImage {
  src: string; kind?: 'image' | 'video'; alt: string; caption: string; originalUrl: string | null;
  gallery?: { position?: string; details?: string; prev?: () => void; next?: () => void; closed?: () => void };
}
const galleryPath = '../renderer/gallery.ts';
const { createGallery, hasPicture } = await import(galleryPath) as {
  hasPicture(item: AttachmentItem): boolean;
  createGallery(source: {
    items(): readonly AttachmentItem[]; more(direction: Direction): boolean; load(direction: Direction): Promise<number>;
    scroll(id: string): void; preload(items: readonly AttachmentItem[]): void; image(item: AttachmentItem): LightboxImage;
    details(item: AttachmentItem): string; present(image: LightboxImage | null, previous?: LightboxImage): boolean;
    start(): Direction; closed(id: string): void;
  }): { open(item: AttachmentItem): void; sync(): void; dispose(): void };
};

const item = (id: string, extra: Partial<AttachmentItem> = {}): AttachmentItem => ({
  id, kind: 'image', status: 'stored', sha256: id, filename: `${id}.png`, spoiler: false, ...extra,
} as AttachmentItem);

function harness(initial: AttachmentItem[], before = false, after = false, start: Direction = -1) {
  let items = initial;
  let current: LightboxImage | null = null;
  const more = new Set<Direction>([...(before ? [-1 as const] : []), ...(after ? [1 as const] : [])]);
  const load = vi.fn(async (_direction: Direction) => 0);
  const scroll = vi.fn();
  const preload = vi.fn();
  const closed = vi.fn();
  const gallery = createGallery({ items: () => items, more: (direction) => more.has(direction), load, scroll, preload, closed, start: () => start,
    image: (i) => ({ src: i.id, kind: i.kind === 'video' ? 'video' : 'image', alt: i.filename, caption: i.filename, originalUrl: null }),
    details: (i) => `details ${i.id}`,
    present: (image, previous) => {
      if (previous !== undefined && current !== previous) return false;
      current = image;
      return true;
    },
  });
  return { gallery, more, load, scroll, preload, closed, current: () => current, close: () => { current = null; },
    rows: (rows: AttachmentItem[]) => { items = rows; } };
}

describe('gallery visual reading order', () => {
  it('loads one page ahead per open, however many pages hold no pictures', async () => {
    const h = harness([item('only')], false, true);
    let page = 0;
    h.load.mockImplementation(async () => {
      h.rows([item('only'), ...Array.from({ length: ++page }, (_, i) => item(`file${i}`, { kind: 'file' }))]);
      h.gallery.sync(); // as the panel's items effect does
      return 1;
    });
    h.gallery.open(item('only'));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('steps images and videos in panel order, skipping missing pictures and spoilers', () => {
    const rows = [item('a'), item('file', { kind: 'file' }), item('spoiler', { spoiler: true }), item('gone', { status: 'evicted' }),
      item('no-hash', { sha256: null }), item('b', { kind: 'video' }), item('c')];
    expect(rows.filter(hasPicture).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    const h = harness(rows);
    h.gallery.open(rows[0]!);
    expect(h.current()?.gallery).toMatchObject({ position: '1 of 3', details: 'details a', prev: undefined });
    expect(h.preload.mock.lastCall?.[0].map((i: AttachmentItem) => i.id)).toEqual(['b']);
    h.current()!.gallery!.next!();
    expect(h.current()).toMatchObject({ src: 'b', kind: 'video', gallery: { position: '2 of 3' } });
    expect(h.scroll).toHaveBeenLastCalledWith('b');
    h.current()!.gallery!.next!();
    expect(h.current()?.gallery).toMatchObject({ position: '3 of 3', next: undefined });
    h.current()!.gallery!.prev!();
    expect(h.current()?.src).toBe('b');
  });

  it('loads top-down below and steps through a page containing no pictures', async () => {
    const a = item('a'); const b = item('b');
    const h = harness([a], false, true);
    let page = 0;
    h.load.mockImplementation(async (direction) => {
      expect(direction).toBe(1);
      if (++page === 1) h.rows([a, item('file', { kind: 'file' })]);
      else { h.rows([a, item('file', { kind: 'file' }), b]); h.more.delete(1); }
      return 1;
    });
    h.gallery.open(a);
    expect(h.current()?.gallery?.position).toBe('1');
    h.current()!.gallery!.next!();
    await vi.waitFor(() => expect(h.current()?.src).toBe('b'));
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.current()?.gallery?.position).toBe('2 of 2');
  });

  it('loads bottom-up above without changing the current file on prepend', async () => {
    const a = item('a'); const b = item('b'); const c = item('c');
    const h = harness([b, a], true, false, 1);
    h.load.mockImplementation(async (direction) => {
      expect(direction).toBe(-1);
      h.rows([c, b, a]); h.more.delete(-1); return 1;
    });
    h.gallery.open(b);
    expect(h.current()?.gallery?.position).toBe('2');
    await vi.waitFor(() => expect(h.current()?.gallery?.position).toBe('2 of 3'));
    expect(h.current()?.src).toBe('b');
    h.current()!.gallery!.prev!();
    expect(h.current()?.src).toBe('c');
    expect(h.current()?.gallery?.prev).toBeUndefined();
  });

  it('never reopens a closed viewer when a page finishes', async () => {
    const a = item('a');
    const h = harness([a], false, true);
    let finish!: (added: number) => void;
    h.load.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    h.gallery.open(a);
    h.current()!.gallery!.next!();
    h.close(); h.rows([a, item('b')]); h.more.delete(1); finish(1);
    await Promise.resolve(); await Promise.resolve();
    expect(h.current()).toBeNull();
  });

  it('shows no position until the start of the order is loaded', () => {
    const a = item('a'); const h = harness([a], true, true);
    h.gallery.open(a);
    expect(h.current()?.gallery?.position).toBeUndefined();
  });

  it('hands the file shown at close back to the panel, once, and never after a step or dispose', () => {
    const a = item('a'); const b = item('b'); const h = harness([a, b]);
    h.gallery.open(a);
    const first = h.current()!;
    first.gallery!.next!();
    first.gallery!.closed!();
    expect(h.closed).not.toHaveBeenCalled();
    h.current()!.gallery!.closed!(); h.current()!.gallery!.closed!();
    expect(h.closed.mock.calls).toEqual([['b']]);
    h.gallery.open(a);
    const disposed = h.current()!;
    h.gallery.dispose();
    disposed.gallery!.closed!();
    expect(h.closed).toHaveBeenCalledOnce();
  });

  it('closes if a privacy refresh removes the current item and disposes its session', () => {
    const a = item('a'); const h = harness([a]);
    h.gallery.open(a); h.rows([]); h.gallery.sync();
    expect(h.current()).toBeNull();
    h.rows([a]); h.gallery.open(a); h.gallery.dispose();
    expect(h.current()).toBeNull();
  });
});

describe('keyboard movement math', () => {
  const rows = [['a', 'b', 'c'], ['d'], ['e', 'f', 'g'], ['h', 'i']];
  it('moves horizontally in reading order without wrapping at the loaded ends', () => {
    expect(moveTo(rows, 'c', 'ArrowRight', 2, true)).toBe('d');
    expect(moveTo(rows, 'd', 'ArrowLeft', 2, true)).toBe('c');
    expect(moveTo(rows, 'a', 'ArrowLeft', 2, true)).toBe('a');
    expect(moveTo(rows, 'i', 'ArrowRight', 2, true)).toBe('i');
  });
  it('clamps vertical moves to short rows, including day-boundary rows', () => {
    expect(moveTo(rows, 'c', 'ArrowDown', 2, true)).toBe('d');
    expect(moveTo(rows, 'g', 'ArrowDown', 2, true)).toBe('i');
    expect(moveTo(rows, 'f', 'ArrowUp', 2, true)).toBe('d');
  });
  it('pages by viewport rows and sends Home/End to loaded edges', () => {
    expect(moveTo(rows, 'c', 'PageDown', 2, true)).toBe('g');
    expect(moveTo(rows, 'i', 'PageUp', 2, true)).toBe('d');
    expect(moveTo(rows, 'g', 'Home', 2, true)).toBe('a');
    expect(moveTo(rows, 'b', 'End', 2, true)).toBe('i');
  });
  it('uses one-item list rows and leaves horizontal arrows alone', () => {
    const list = rows.flat().map((id) => [id]);
    expect(moveTo(list, 'c', 'ArrowDown', 3, false)).toBe('d');
    expect(moveTo(list, 'c', 'PageDown', 3, false)).toBe('f');
    expect(moveTo(list, 'c', 'ArrowLeft', 3, false)).toBe('c');
    expect(moveTo([], 'c', 'End', 3, false)).toBe('c');
  });
});
