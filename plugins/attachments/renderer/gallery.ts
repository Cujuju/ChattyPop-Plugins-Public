import type { LightboxImage } from '@plugin-sdk/renderer/kit';
import type { AttachmentItem } from '../shared/types';

export type Direction = -1 | 1;
export const GALLERY_LOAD_AHEAD = 3;
export const hasPicture = (item: AttachmentItem): boolean => !item.spoiler && item.status === 'stored' && !!item.sha256
  && (item.kind === 'image' || item.kind === 'video');

export interface GallerySource {
  items(): readonly AttachmentItem[];
  more(direction: Direction): boolean;
  load(direction: Direction): Promise<number>;
  image(item: AttachmentItem): LightboxImage;
  details(item: AttachmentItem): string;
  /** Replaces only this session's viewer; false after it was closed or another caller opened one. */
  present(image: LightboxImage | null, previous?: LightboxImage): boolean;
  scroll(id: string): void;
  preload(items: readonly AttachmentItem[]): void;
}

/** Reads visual order anew after every page; ids survive pages prepended at the top. */
export function createGallery(source: GallerySource) {
  let id: string | null = null;
  let shown: LightboxImage | undefined;
  let moving = false;
  let generation = 0;
  const pictures = (): AttachmentItem[] => source.items().filter(hasPicture);
  const sync = (): boolean => {
    if (id === null) return false;
    const items = pictures();
    const index = items.findIndex((item) => item.id === id);
    const item = items[index];
    if (!item) { source.present(null, shown); id = null; return false; }
    const image: LightboxImage = { ...source.image(item), gallery: {
      position: source.more(-1) || source.more(1) ? String(index + 1) : `${index + 1} of ${items.length}`,
      details: source.details(item),
      prev: index > 0 || source.more(-1) ? () => void step(-1) : undefined,
      next: index < items.length - 1 || source.more(1) ? () => void step(1) : undefined,
    } };
    if (!source.present(image, shown)) { id = null; return false; }
    shown = image;
    source.preload([items[index - 1], items[index + 1]].filter((i): i is AttachmentItem => !!i));
    return true;
  };
  let loading: Promise<void> | null = null;
  /** One page ahead per open or step: a run of files without pictures loads only as the reader steps into it. */
  const warm = (): void => {
    if (loading || id === null) return;
    const items = pictures();
    const index = items.findIndex((item) => item.id === id);
    const direction = index < GALLERY_LOAD_AHEAD && source.more(-1) ? -1
      : items.length - index - 1 < GALLERY_LOAD_AHEAD && source.more(1) ? 1 : null;
    if (direction === null) return;
    const mine = generation;
    loading = source.load(direction).then((added) => {
      loading = null;
      if (mine === generation && added > 0) sync();
    }, () => { loading = null; });
  };
  const step = async (direction: Direction): Promise<void> => {
    if (moving || !sync()) return;
    moving = true;
    const mine = generation;
    try {
      for (;;) {
        const items = pictures();
        const index = items.findIndex((item) => item.id === id);
        const next = items[index + direction];
        if (next) {
          id = next.id;
          if (sync()) { source.scroll(next.id); warm(); }
          return;
        }
        if (!source.more(direction)) return;
        const added = loading ? (await loading, 1) : await source.load(direction);
        if (mine !== generation || !sync() || added === 0) return;
      }
    } finally { moving = false; }
  };
  return {
    /** Items changed: refresh the viewer only; loading ahead waits for the reader to open or step. */
    sync: (): void => { sync(); },
    open(item: AttachmentItem): void {
      if (!hasPicture(item)) return;
      generation++;
      id = item.id;
      shown = undefined;
      if (sync()) { source.scroll(item.id); warm(); }
    },
    dispose: (): void => { generation++; if (shown) source.present(null, shown); id = null; },
  };
}
