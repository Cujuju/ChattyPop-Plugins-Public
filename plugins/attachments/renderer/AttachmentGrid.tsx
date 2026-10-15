import { For, Show, createSignal } from 'solid-js';
import { formatBytes, look } from '@plugin-sdk/renderer/kit';
import type { AttachmentItem } from '../shared/types';
import { clickAttachment, itemMarks, showItemMenu } from './actions';
import { AttachmentPicture } from './AttachmentPicture';
import { compressionJob, selection, type AttachmentSelection } from './selection';
import { hoverZoom } from './state';
import { zoomWithin, type Box, type TileZoom } from './zoom';
import styles from './Attachments.module.css';

/** The inside (scrollbars excluded) of `el`'s nearest ancestor that clips: a zoomed picture is cut at its edges. */
function clipBox(el: HTMLElement): Box {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflow === 'visible') continue;
    const r = p.getBoundingClientRect();
    return { left: r.left + p.clientLeft, top: r.top + p.clientTop, width: p.clientWidth, height: p.clientHeight };
  }
  return { left: 0, top: 0, width: innerWidth, height: innerHeight };
}

export function AttachmentGrid(props: { item: AttachmentItem; selection?: AttachmentSelection }) {
  const selected = (): boolean => (props.selection ?? selection).ids().has(props.item.id);
  const size = (): string => formatBytes(props.item.sortBytes);
  // Measured as the pointer enters, so the zoom fits where the tile is now.
  const [zoom, setZoom] = createSignal<TileZoom | null>(null);
  const title = (): string => `${props.item.filename} · ${size()} · ${props.item.authorName || 'Unknown person'} · #${props.item.channelName}${props.item.guildName ? ` · ${props.item.guildName}` : ''}`;
  return (
    <button type="button" class={`${styles.cell} ${look.mediaCell}`} aria-pressed={selected()} aria-label={title()}
      data-kind={props.item.kind} data-state={compressionJob()?.current === props.item.id ? 'busy' : undefined}
      data-attachment-id={props.item.id} title={title()}
      onPointerEnter={(e) => setZoom(zoomWithin(e.currentTarget.getBoundingClientRect(), clipBox(e.currentTarget), hoverZoom()))}
      onClick={(e) => clickAttachment(e, props.item, false, props.selection)}
      onContextMenu={(e) => { e.preventDefault(); showItemMenu(e.currentTarget, props.item, props.selection); }}>
      <AttachmentPicture item={props.item} zoom={zoom()} />
      <span class={styles.cornerEnd}><span class={`${look.durationBadge} ${look.text}`} data-size="2xs" data-figures="tabular">{size()}</span></span>
      <span class={styles.cornerStart}>
        <Show when={props.item.kind === 'video' || props.item.kind === 'audio'}><span class={`${look.tag} ${look.text}`} data-size="2xs">{props.item.kind}</span></Show>
        <For each={itemMarks(props.item)}>{(mark) => <span class={`${look.tag} ${look.text}`} data-size="2xs">{mark}</span>}</For>
      </span>
    </button>
  );
}
