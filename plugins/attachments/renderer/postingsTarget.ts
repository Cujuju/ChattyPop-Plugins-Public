import { createSignal } from 'solid-js';
import type { AttachmentItem } from '../shared/types';

/** The file whose postings show, and the tile or row the popover hangs from: one at a time, drawn once by the panel. */
export const [postingsTarget, setPostingsTarget] = createSignal<{ item: AttachmentItem; anchor: Element } | null>(null);
