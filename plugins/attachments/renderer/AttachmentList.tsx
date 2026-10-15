import { Icon, formatBytes, look, openArchive, shortDate } from '@plugin-sdk/renderer/kit';
import type { AttachmentItem } from '../shared/types';
import { clickAttachment, itemMarks, placeText, showItemMenu } from './actions';
import { AttachmentPicture } from './AttachmentPicture';
import { compressionJob, selectedIds } from './selection';
import styles from './Attachments.module.css';

export function AttachmentList(props: { item: AttachmentItem }) {
  const bytes = (): string => formatBytes(props.item.sortBytes);
  return (
    <div class={`${styles.listRow} ${look.row}`} data-attachment-id={props.item.id}
      data-state={compressionJob()?.current === props.item.id ? 'busy' : undefined}
      onClick={(e) => { if (!(e.target as Element).closest('button,input')) clickAttachment(e, props.item); }}
      onContextMenu={(e) => { e.preventDefault(); showItemMenu(e.currentTarget, props.item); }}>
      <input type="checkbox" class={styles.listPick} aria-label={`Select ${props.item.filename}`} checked={selectedIds().has(props.item.id)}
        onClick={(e) => clickAttachment(e, props.item, true)} />
      <button type="button" class={`${styles.listThumb} ${look.mediaCell}`} aria-label={`Open ${props.item.filename}`}
        onClick={(e) => clickAttachment(e, props.item)}><AttachmentPicture item={props.item} list /></button>
      <div class={styles.listMain}>
        <button type="button" class={`${styles.listName} ${look.quietLink} ${look.text}`} data-size="sm"
          title={props.item.filename} onClick={(e) => clickAttachment(e, props.item)}>{props.item.filename}</button>
        <button type="button" class={`${styles.listMeta} ${look.quietLink} ${look.text}`} data-size="2xs"
          onClick={() => void openArchive(props.item.channelId, props.item.messageId)}>
          {[props.item.authorName || 'Unknown person', placeText(props.item), shortDate(props.item.ts)].filter(Boolean).join(' · ')}
        </button>
      </div>
      <span class={`${styles.listKind} ${look.text}`} data-size="2xs" data-tone="muted">
        {[props.item.kind, ...itemMarks(props.item)].join(' · ')}
      </span>
      <span class={`${styles.listSize} ${look.text}`} data-size="xs" data-figures="tabular"
        title={props.item.compressed ? `now ${bytes()}, was ${formatBytes(props.item.size ?? 0)}` : undefined}>{bytes()}</span>
      <button type="button" class={`${styles.listMenu} ${look.iconButton}`} aria-label={`Menu for ${props.item.filename}`}
        onClick={(e) => showItemMenu(e.currentTarget, props.item)}><Icon name="more" /></button>
    </div>
  );
}
