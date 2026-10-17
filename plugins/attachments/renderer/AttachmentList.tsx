import { For, Show } from 'solid-js';
import { onCleanup } from '@plugin-sdk/renderer';
import { Icon, formatBytes, look, openArchive, shortDate } from '@plugin-sdk/renderer/kit';
import type { AttachmentItem, AttachmentSort, AttachmentSortKey } from '../shared/types';
import { clickAttachment, itemMarks, placeText, showItemMenu } from './actions';
import { AttachmentPicture } from './AttachmentPicture';
import { canDragOut, dragOut } from './folderSave';
import { compressionJob, selectedIds, selection } from './selection';
import { attachments, queryName, setSort, sort } from './state';
import { textHighlights } from './textHighlights';
import styles from './Attachments.module.css';
import type { AttachmentKeyboard } from './keyboard';

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
    // Not table roles: the rows under it are a virtual list, not a table, so each control says its own state.
    <div class={`${styles.listColumns} ${styles.listHeader} ${look.ruleBelow}`} data-rule="subtle" role="group" aria-label="Sort files">
      <input type="checkbox" class={styles.listPick} aria-label="Select all loaded" checked={all()}
        onClick={() => all() ? selection.clear() : selection.selectAll()} />
      <span aria-hidden="true" />
      <For each={COLUMNS}>{(c) => (
        <span class={c.class}>
          <button type="button" class={`${styles.sortButton} ${look.quietButton} ${look.text}`} data-size="xs" data-weight="semibold"
            aria-label={sort().key === c.key ? `${c.label}, sorted ${sort().dir === 'asc' ? 'ascending' : 'descending'}` : `Sort by ${c.label.toLowerCase()}`}
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

export function AttachmentList(props: { item: AttachmentItem; keyboard?: AttachmentKeyboard; openGallery?: (item: AttachmentItem) => void }) {
  const bytes = (): string => formatBytes(props.item.sortBytes);
  const whoWhere = (): string => [props.item.authorName || 'Unknown person', placeText(props.item)].filter(Boolean).join(' · ');
  return (
    <div class={`${styles.listColumns} ${styles.listRow} ${look.row}`} data-attachment-id={props.item.id} title={props.item.textMatch ? whoWhere() : undefined}
      ref={(el) => { const remove = props.keyboard?.register(props.item.id, el); onCleanup(() => remove?.()); }}
      draggable={canDragOut(props.item)} onDragStart={(e) => dragOut(e, props.item)}
      tabIndex={props.keyboard?.tabId() === props.item.id ? 0 : -1} role="group" aria-label={props.item.filename}
      onFocus={() => props.keyboard?.focused(props.item.id)}
      onKeyDown={(e) => { if (e.target === e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) props.keyboard?.keydown(e, props.item); }}
      data-state={compressionJob()?.current === props.item.id ? 'busy' : undefined}
      onClick={(e) => { if (!(e.target as Element).closest('button,input')) clickAttachment(e, props.item, false, selection, props.openGallery); }}
      onContextMenu={(e) => { e.preventDefault(); showItemMenu(e.currentTarget, props.item, selection, props.openGallery); }}>
      <input type="checkbox" tabIndex={-1} class={styles.listPick} aria-label={`Select ${props.item.filename}`} checked={selectedIds().has(props.item.id)}
        onClick={(e) => clickAttachment(e, props.item, true)} />
      <button type="button" tabIndex={-1} class={`${styles.listThumb} ${look.mediaCell}`} aria-label={`Open ${props.item.filename}`}
        onClick={(e) => clickAttachment(e, props.item, false, selection, props.openGallery)}><AttachmentPicture item={props.item} list /></button>
      <div class={styles.listMain}>
        <button type="button" tabIndex={-1} class={`${styles.listName} ${look.quietLink} ${look.text}`} data-size="sm"
          title={props.item.filename} onClick={(e) => clickAttachment(e, props.item, false, selection, props.openGallery)}>{props.item.filename}</button>
        <Show when={props.item.textMatch} fallback={<button type="button" tabIndex={-1} class={`${styles.listMeta} ${look.quietLink} ${look.text}`} data-size="2xs"
          onClick={() => void openArchive(props.item.channelId, props.item.messageId)}>{whoWhere()}</button>}>
          {(match) => <span class={`${styles.listMeta} ${look.text}`} data-size="2xs" data-tone="muted" title={match().snippet}>
            <For each={textHighlights(match().snippet, queryName())}>{(part) => <span class={look.text} data-weight={part.matched ? 'semibold' : undefined}>{part.text}</span>}</For>
          </span>}
        </Show>
      </div>
      <span class={`${styles.listKind} ${look.text}`} data-size="2xs" data-tone="muted" title={[props.item.kind, ...itemMarks(props.item)].join(' · ')}>
        {[props.item.kind, ...itemMarks(props.item)].join(' · ')}
        <Show when={props.item.postings > 1}> · {props.item.postings}×</Show>
      </span>
      <span class={`${styles.listSize} ${look.text}`} data-size="xs" data-figures="tabular"
        title={props.item.compressed ? `now ${bytes()}, was ${formatBytes(props.item.size ?? 0)}` : undefined}>{bytes()}</span>
      <span class={`${styles.listDate} ${look.text}`} data-size="xs" data-tone="secondary" data-figures="tabular">{shortDate(props.item.ts)}</span>
      <button type="button" tabIndex={-1} class={`${styles.listMenu} ${look.iconButton}`} aria-label={`Menu for ${props.item.filename}`}
        onClick={(e) => showItemMenu(e.currentTarget, props.item, selection, props.openGallery)}><Icon name="more" /></button>
    </div>
  );
}
