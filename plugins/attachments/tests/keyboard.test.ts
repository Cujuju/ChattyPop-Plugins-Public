import { describe, expect, it, vi } from 'vitest';
import type { AttachmentItem } from '../shared/types';

vi.mock('solid-js', async () => { const clientBuild = 'solid-js/dist/solid.cjs'; return import(clientBuild); });
vi.mock('@plugin-sdk/renderer', async () => ({ ...(await import('@plugin-sdk/renderer/containment')) }));
/** The selection members these tests and the keyboard use; renderer modules are imported by path so the node type-check doesn't follow the SDK. */
interface Selection {
  ids(): ReadonlySet<string>; selecting(): boolean; start(): void; done(): void; clear(): void;
  retain(loaded: readonly AttachmentItem[]): void; toggle(id: string, range?: boolean): void; extend(firstId: string, lastId: string): void; selectAll(): void;
}
const selectionPath = '../renderer/selection.ts';
const { createSelection } = await import(selectionPath) as { createSelection(): Selection };
/** The members of a tile element the keyboard reads; tests run without a DOM. */
type FakeElement = { ownerDocument: { body: unknown; activeElement: unknown }; isConnected: boolean; focus(): void; contains(other: unknown): boolean };
type Key = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; preventDefault(): void; stopPropagation(): void };
const keyboardPath = '../renderer/keyboard.ts';
const { createAttachmentKeyboard } = await import(keyboardPath) as {
  createAttachmentKeyboard(source: {
    rows(): string[][]; visible(): string[]; pageRows(): number; grid(): boolean; scroll(id: string): void;
    more(direction: -1 | 1): boolean; load(direction: -1 | 1): Promise<number>; open(item: AttachmentItem): void;
    selection: Selection;
  }): { tabId(): string | undefined; preview(): string | null; focused(id: string): void; clearPreview(): void;
    register(id: string, el: FakeElement): () => void;
    keydown(e: Key, item: AttachmentItem): void; dispose(): void };
};
const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id } as AttachmentItem));
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };
function harness() {
  let rows = [['a', 'b'], ['c', 'd'], ['e', 'f']];
  let visible = ['a', 'b', 'c', 'd'];
  const selection = createSelection(); selection.retain(items);
  const scroll = vi.fn(); const open = vi.fn(); const load = vi.fn(async (_direction: -1 | 1) => 0);
  const more = new Set<-1 | 1>();
  const k = createAttachmentKeyboard({ rows: () => rows, visible: () => visible, pageRows: () => 2, grid: () => true,
    scroll, open, load, more: (direction) => more.has(direction), selection });
  return { k, scroll, open, load, more, selection,
    rows: (r: string[][]) => { rows = r; }, visible: (ids: string[]) => { visible = ids; },
    key(key: string, id = 'a', modifiers: Partial<Key> = {}): void {
      k.keydown({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...modifiers }, items.find((i) => i.id === id)!);
    } };
}

describe('attachment roving focus and shortcuts', () => {
  it('drops a move whose page load finishes after focus moved on', async () => {
    const h = harness();
    let finish!: (added: number) => void;
    h.load.mockImplementationOnce(() => new Promise<number>((resolve) => { finish = resolve; }));
    h.more.add(-1);
    h.k.focused('a');
    h.key('ArrowUp', 'a');
    h.k.focused('d');
    h.rows([['prior'], ['a', 'b'], ['c', 'd'], ['e', 'f']]);
    finish(1); await settle();
    expect(h.k.tabId()).toBe('d');
  });
  it('gives focus back to a focused tile that remounts, but never takes it from another element', async () => {
    const h = harness();
    const doc = { body: {}, activeElement: null as unknown };
    const element = () => { const el = { ownerDocument: doc, isConnected: true, focus: vi.fn<() => void>(), contains: (o: unknown): boolean => o === el }; return el; };
    const first = element();
    const unregister = h.k.register('a', first);
    doc.activeElement = first;
    unregister();
    doc.activeElement = doc.body;
    const second = element();
    const unregisterSecond = h.k.register('a', second);
    await settle();
    expect(second.focus).toHaveBeenCalledTimes(1);
    doc.activeElement = second;
    unregisterSecond();
    doc.activeElement = { elsewhere: true };
    const fourth = element();
    h.k.register('a', fourth);
    await settle();
    expect(fourth.focus).not.toHaveBeenCalled();
  });
  it('has a single visible Tab stop, follows moves, and falls back when a row is virtualized away', () => {
    const h = harness();
    expect(h.k.tabId()).toBe('a');
    h.key('ArrowDown');
    expect(h.k.tabId()).toBe('c');
    expect(h.scroll).toHaveBeenLastCalledWith('c');
    h.visible(['e', 'f']);
    expect(h.k.tabId()).toBe('e');
  });
  it('ends preview on move, Escape, blur/leave and disposal; Escape then exits selection', () => {
    const h = harness(); h.selection.start();
    h.key(' '); expect(h.k.preview()).toBe('a');
    h.key('Escape'); expect(h.k.preview()).toBeNull(); expect(h.selection.selecting()).toBe(true);
    h.key('Escape'); expect(h.selection.selecting()).toBe(false);
    h.key(' '); h.k.clearPreview(); expect(h.k.preview()).toBeNull();
    h.key(' '); h.key('ArrowRight'); expect(h.k.preview()).toBeNull();
    h.k.dispose(); expect(h.k.preview()).toBeNull();
  });
  it('opens with Enter, extends ranges from a fixed anchor, and selects all loaded with Ctrl/Cmd+A', () => {
    const h = harness();
    h.key('Enter'); expect(h.open).toHaveBeenCalledWith(items[0]);
    h.key('ArrowRight', 'a', { shiftKey: true });
    expect([...h.selection.ids()]).toEqual(['a', 'b']);
    h.key('ArrowDown', 'b', { shiftKey: true });
    expect([...h.selection.ids()]).toEqual(['a', 'b', 'c', 'd']);
    h.selection.clear(); h.key('a', 'a', { ctrlKey: true });
    expect(h.selection.ids().size).toBe(items.length);
    h.selection.clear(); h.key('A', 'a', { metaKey: true });
    expect(h.selection.ids().size).toBe(items.length);
  });
  it('loads and moves past a top loaded edge by stable id', async () => {
    const h = harness(); h.more.add(-1);
    h.load.mockImplementation(async () => { h.rows([['before'], ['a', 'b'], ['c', 'd'], ['e', 'f']]); h.more.clear(); return 1; });
    h.key('ArrowUp'); await settle();
    expect(h.load).toHaveBeenCalledWith(-1);
    expect(h.scroll).toHaveBeenLastCalledWith('before');
  });
  it('starts a new keyboard range after focus moves independently', () => {
    const h = harness();
    h.key('ArrowRight', 'a', { shiftKey: true });
    h.k.focused('e');
    h.key('ArrowRight', 'e', { shiftKey: true });
    expect([...h.selection.ids()]).toEqual(['a', 'b', 'e', 'f']);
  });
});
