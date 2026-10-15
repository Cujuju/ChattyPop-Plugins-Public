import { For, Show } from 'solid-js';
import { Icon, formatBytes, look, openArchive, shortDate } from '@plugin-sdk/renderer/kit';
import type { AttachmentItem, AttachmentSort, AttachmentSortKey } from '../shared/types';
import { clickAttachment, itemMarks, placeText, showItemMenu } from './actions';
import { AttachmentPicture } from './AttachmentPicture';
import { compressionJob, selectedIds, selection } from './selection';
import { attachments, setSort, sort } from './state';
import styles from './Attachments.module.css';

/** The sortable columns, each with the direction its first click sorts in: names A to Z, sizes and dates largest and newest first. */
const COLUMNS: { key: AttachmentSortKey; label: string; first: AttachmentSort['dir']; class: string }[] = [
  { key: 'name', label: 'Name', first: 'asc', class: styles.listMain! },
  { key: 'kind', label: 'Kind', first: 'asc', class: styles.listKind! },
  { key: 'size', label: 'Size', first: 'desc', class: styles.listSize! },
  { key: 'date', label: 'Date', first: 'desc', class: styles.listDate! },
];

/** The list's column heads, over the scroller: select all loaded, then a sort per column; a second click reverses it. */
export function AttachmentListHeader() {
  const all = () => attachments.items.length > 0 && selectedIds().size === attachments.items.length;
  const order = (key: AttachmentSortKey, first: AttachmentSort['dir']): void =>
    void setSort(sort().key === key ? { key, dir: sort().dir === 'asc' ? 'desc' : 'asc' } : { key, dir: first });
  return (
    <div class={`${styles.listColumns} ${styles.listHeader} ${look.ruleBelow}`} data-rule="subtle" role="row">
      <input type="checkbox" class={styles.listPick} aria-label="Select all loaded" checked={all()}
        onClick={() => all() ? selection.clear() : selection.selectAll()} />
      <span aria-hidden="true" />
      <For each={COLUMNS}>{(c) => (
        <span class={c.class} role="columnheader" aria-sort={sort().key === c.key ? (sort().dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
          <button type="button" class={`${styles.sortButton} ${look.quietButton} ${look.text}`} data-size="xs" data-weight="semibold"
            onClick={() => order(c.key, c.first)}>
            {c.label}
            <Show when={sort().key === c.key}><Icon name={sort().dir === 'asc' ? 'arrowUp' : 'arrowDown'} class={styles.sortIcon} /></Show>
          </button>
        </span>
      )}</For>
      <span aria-hidden="true" />
    </div>
  );
}

export function AttachmentList(props: { item: AttachmentItem }) {
  const bytes = (): string => formatBytes(props.item.sortBytes);
  return (
    <div class={`${styles.listColumns} ${styles.listRow} ${look.row}`} data-attachment-id={props.item.id}
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
          {[props.item.authorName || 'Unknown person', placeText(props.item)].filter(Boolean).join(' · ')}
        </button>
      </div>
      <span class={`${styles.listKind} ${look.text}`} data-size="2xs" data-tone="muted" title={[props.item.kind, ...itemMarks(props.item)].join(' · ')}>
        {[props.item.kind, ...itemMarks(props.item)].join(' · ')}
      </span>
      <span class={`${styles.listSize} ${look.text}`} data-size="xs" data-figures="tabular"
        title={props.item.compressed ? `now ${bytes()}, was ${formatBytes(props.item.size ?? 0)}` : undefined}>{bytes()}</span>
      <span class={`${styles.listDate} ${look.text}`} data-size="xs" data-tone="secondary" data-figures="tabular">{shortDate(props.item.ts)}</span>
      <button type="button" class={`${styles.listMenu} ${look.iconButton}`} aria-label={`Menu for ${props.item.filename}`}
        onClick={(e) => showItemMenu(e.currentTarget, props.item)}><Icon name="more" /></button>
    </div>
  );
}
