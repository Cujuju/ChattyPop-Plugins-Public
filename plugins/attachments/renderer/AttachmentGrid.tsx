import { For, Show } from 'solid-js';
import { formatBytes, look } from '@plugin-sdk/renderer/kit';
import type { AttachmentItem } from '../shared/types';
import { clickAttachment, itemMarks, showItemMenu } from './actions';
import { AttachmentPicture } from './AttachmentPicture';
import { compressionJob, selection, type AttachmentSelection } from './selection';
import styles from './Attachments.module.css';

export function AttachmentGrid(props: { item: AttachmentItem; selection?: AttachmentSelection }) {
  const selected = (): boolean => (props.selection ?? selection).ids().has(props.item.id);
  const size = (): string => formatBytes(props.item.sortBytes);
  const title = (): string => `${props.item.filename} · ${size()} · ${props.item.authorName || 'Unknown person'} · #${props.item.channelName}${props.item.guildName ? ` · ${props.item.guildName}` : ''}`;
  return (
    <button type="button" class={`${styles.cell} ${look.mediaCell}`} aria-pressed={selected()} aria-label={title()}
      data-kind={props.item.kind} data-state={compressionJob()?.current === props.item.id ? 'busy' : undefined}
      data-attachment-id={props.item.id} title={title()}
      onClick={(e) => clickAttachment(e, props.item, false, props.selection)}
      onContextMenu={(e) => { e.preventDefault(); showItemMenu(e.currentTarget, props.item, props.selection); }}>
      <AttachmentPicture item={props.item} />
      <span class={styles.cornerEnd}><span class={`${look.durationBadge} ${look.text}`} data-size="2xs" data-figures="tabular">{size()}</span></span>
      <span class={styles.cornerStart}>
        <Show when={props.item.kind === 'video' || props.item.kind === 'audio'}><span class={`${look.tag} ${look.text}`} data-size="2xs">{props.item.kind}</span></Show>
        <For each={itemMarks(props.item)}>{(mark) => <span class={`${look.tag} ${look.text}`} data-size="2xs">{mark}</span>}</For>
      </span>
    </button>
  );
}
