import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { formatBytes, look } from '@plugin-sdk/renderer/kit';
import type { AttachmentItem } from '../shared/types';
import { clickAttachment, itemMarks, showItemMenu } from './actions';
import { AttachmentPicture } from './AttachmentPicture';
import { compressionJob, selection, type AttachmentSelection } from './selection';
import { hoverZoom } from './state';
import { zoomWithin, type Box, type TileZoom } from './zoom';
import styles from './Attachments.module.css';
import type { AttachmentKeyboard } from './keyboard';

/**
 * What of the window every ancestor of `el` leaves showing, each clipping only on the axes it clips (insides, scrollbars
 * excluded): a zoomed picture is cut at any of their edges. A virtual list's canvas clips one axis but spans the whole
 * scroll height, so the first clipping ancestor alone is not enough.
 */
function clipBox(el: HTMLElement): Box {
  let [left, top, right, bottom] = [0, 0, innerWidth, innerHeight];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const r = p.getBoundingClientRect();
    if (style.overflowX !== 'visible') [left, right] = [Math.max(left, r.left + p.clientLeft), Math.min(right, r.left + p.clientLeft + p.clientWidth)];
    if (style.overflowY !== 'visible') [top, bottom] = [Math.max(top, r.top + p.clientTop), Math.min(bottom, r.top + p.clientTop + p.clientHeight)];
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function AttachmentGrid(props: { item: AttachmentItem; selection?: AttachmentSelection; keyboard?: AttachmentKeyboard; openGallery?: (item: AttachmentItem) => void }) {
  const selected = (): boolean => (props.selection ?? selection).ids().has(props.item.id);
  const size = (): string => formatBytes(props.item.sortBytes);
  // Measured as the pointer enters, so the zoom fits where the tile is now.
  const [zoom, setZoom] = createSignal<TileZoom | null>(null);
  const [hovered, setHovered] = createSignal(false);
  let cell!: HTMLButtonElement;
  const measureZoom = (): void => { setZoom(zoomWithin(cell.getBoundingClientRect(), clipBox(cell), hoverZoom())); };
  createEffect(() => { if (props.keyboard?.preview() === props.item.id) measureZoom(); });
  const title = (): string => `${props.item.filename} · ${size()} · ${props.item.authorName || 'Unknown person'} · #${props.item.channelName}${props.item.guildName ? ` · ${props.item.guildName}` : ''}`;
  return (
    <button type="button" class={`${styles.cell} ${look.mediaCell}`} aria-pressed={selected()} aria-label={title()}
      ref={(el) => { cell = el; const remove = props.keyboard?.register(props.item.id, el); onCleanup(() => remove?.()); }}
      tabIndex={props.keyboard ? props.keyboard.tabId() === props.item.id ? 0 : -1 : 0}
      data-preview={props.keyboard?.preview() === props.item.id ? true : undefined}
      onFocus={() => props.keyboard?.focused(props.item.id)}
      onBlur={() => props.keyboard?.clearPreview()}
      onKeyDown={(e) => props.keyboard?.keydown(e, props.item)}
      data-kind={props.item.kind} data-state={compressionJob()?.current === props.item.id ? 'busy' : undefined}
      data-attachment-id={props.item.id} title={title()}
      onPointerEnter={() => { measureZoom(); setHovered(true); }}
      onPointerLeave={() => { setHovered(false); props.keyboard?.clearPreview(); }}
      onClick={(e) => clickAttachment(e, props.item, false, props.selection, props.openGallery)}
      onContextMenu={(e) => { e.preventDefault(); showItemMenu(e.currentTarget, props.item, props.selection, props.openGallery); }}>
      <AttachmentPicture item={props.item} zoom={zoom()} hovered={hovered()} />
      <span class={styles.cornerEnd}><span class={`${look.durationBadge} ${look.text}`} data-size="2xs" data-figures="tabular">{size()}</span></span>
      <span class={styles.cornerStart}>
        <Show when={props.item.kind === 'video' || props.item.kind === 'audio'}><span class={`${look.tag} ${look.text}`} data-size="2xs">{props.item.kind}</span></Show>
        <For each={itemMarks(props.item)}>{(mark) => <span class={`${look.tag} ${look.text}`} data-size="2xs">{mark}</span>}</For>
      </span>
    </button>
  );
}
