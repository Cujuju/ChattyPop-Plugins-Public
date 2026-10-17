import { createSignal } from 'solid-js';
import type { AttachmentItem } from '../shared/types';
import type { Direction } from './gallery';
import { isMovementKey, moveTo, type MovementKey } from './movement';
import type { AttachmentSelection } from './selection';

export interface AttachmentKeyboardSource {
  rows(): string[][];
  visible(): string[];
  pageRows(): number;
  grid(): boolean;
  scroll(id: string): void;
  more(direction: Direction): boolean;
  load(direction: Direction): Promise<number>;
  open(item: AttachmentItem): void;
  menu?(anchor: Element, item: AttachmentItem): void;
  selection: AttachmentSelection;
}

export function createAttachmentKeyboard(source: AttachmentKeyboardSource) {
  const [current, setCurrent] = createSignal<string | null>(null);
  const [preview, setPreview] = createSignal<string | null>(null);
  const elements = new Map<string, HTMLElement>();
  let pending: string | null = null;
  let rangeAnchor: string | null = null;
  let moving = false;
  let disposed = false;
  const tabId = (): string | undefined => {
    const visible = source.visible();
    return visible.includes(current() ?? '') ? current()! : visible[0];
  };
  const focus = (id: string): void => {
    setCurrent(id);
    source.scroll(id);
    pending = id;
    const el = elements.get(id);
    if (el) { pending = null; el.focus({ preventScroll: true }); }
  };
  const move = async (id: string, key: MovementKey, shift: boolean): Promise<void> => {
    if (moving || disposed) return;
    moving = true;
    setPreview(null);
    try {
      const next = (): string => moveTo(source.rows(), id, key, source.pageRows(), source.grid());
      const direction: Direction = key === 'ArrowUp' || key === 'ArrowLeft' || key === 'PageUp' ? -1 : 1;
      if (next() === id && key !== 'Home' && key !== 'End' && source.more(direction)) await source.load(direction);
      if (disposed || !source.rows().flat().includes(id)) return;
      const target = next();
      if (shift && key.startsWith('Arrow')) {
        if (!source.selection.selecting()) rangeAnchor = id;
        rangeAnchor ??= id;
        source.selection.extend(rangeAnchor, target);
      } else rangeAnchor = null;
      focus(target);
      const all = source.rows().flat();
      if (target === (direction < 0 ? all[0] : all.at(-1)) && source.more(direction)) void source.load(direction).catch(() => undefined);
    } catch { /* The loader owns the panel's read failure. */
    } finally { moving = false; }
  };
  return {
    tabId, preview, focus,
    clearPreview: (): void => { setPreview(null); },
    focused: (id: string): void => { if (current() !== id) { rangeAnchor = null; setPreview(null); } setCurrent(id); },
    register(id: string, el: HTMLElement): () => void {
      elements.set(id, el);
      if (pending === id) queueMicrotask(() => { if (pending === id && el.isConnected) { pending = null; el.focus({ preventScroll: true }); } });
      return () => { if (elements.get(id) === el) elements.delete(id); };
    },
    keydown(event: KeyboardEvent, item: AttachmentItem): void {
      if (event.altKey) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault(); source.selection.selectAll(); return;
      }
      if (event.ctrlKey || event.metaKey) return;
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault(); source.menu?.(event.currentTarget as Element, item);
      } else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (preview()) setPreview(null);
        else { source.selection.done(); rangeAnchor = null; }
      } else if (event.key === ' ') {
        event.preventDefault();
        if (source.grid()) setPreview((old) => old === item.id ? null : item.id);
        else source.selection.toggle(item.id, event.shiftKey);
      } else if (event.key === 'Enter') {
        event.preventDefault(); source.open(item);
      } else if (isMovementKey(event.key)) {
        if (!source.grid() && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return;
        event.preventDefault(); void move(item.id, event.key, event.shiftKey);
      }
    },
    dispose: (): void => { disposed = true; pending = null; elements.clear(); setPreview(null); },
  };
}
export type AttachmentKeyboard = ReturnType<typeof createAttachmentKeyboard>;
