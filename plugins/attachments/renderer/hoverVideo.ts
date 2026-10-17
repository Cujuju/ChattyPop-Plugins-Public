import { createSignal } from 'solid-js';
import type { AttachmentItem } from '../shared/types';

export const HOVER_PLAY_DELAY_MS = 350;
export const canHoverPlay = (item: AttachmentItem, options: { hovered: boolean; list: boolean; reducedMotion: boolean }): boolean =>
  options.hovered && !options.list && !options.reducedMotion && !item.spoiler && item.kind === 'video' && item.status === 'stored' && !!item.sha256;
/** A pending hover cancels the previous tile immediately; an old leave cannot stop its successor. */
export function createHoverPlayer() {
  const [active, setActive] = createSignal<symbol | null>(null);
  let owner: symbol | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const leave = (token: symbol): void => {
    if (owner !== token) return;
    clearTimeout(timer);
    owner = null;
    setActive(null);
  };
  return {
    active,
    enter(token: symbol): void {
      clearTimeout(timer);
      owner = token;
      setActive(null);
      timer = setTimeout(() => { if (owner === token) setActive(token); }, HOVER_PLAY_DELAY_MS);
    },
    leave,
  };
}
export const hoverPlayer = createHoverPlayer();
