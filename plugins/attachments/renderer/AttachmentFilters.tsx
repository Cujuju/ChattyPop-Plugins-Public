import { For, Show } from 'solid-js';
import { Icon, SearchSelect, SegButton, SegGroup, Select, Switch, canCompressHere, look } from '@plugin-sdk/renderer/kit';
import { ATTACHMENT_KINDS, type AttachmentPresence } from '../shared/types';
import {
  ATTACHMENT_RANGES, MIN_SIZE_OPTIONS, kinds, minBytes, name, people, presence, range, setKinds, setMinBytes, setName,
  setPresence, setRange, setSort, setUncompressed, setWho, sort, totals, uncompressed, who, type AttachmentRange,
} from './state';
import { KIND_ICON } from './AttachmentPicture';
import styles from './AttachmentFilters.module.css';

const KIND_LABEL = { image: 'Images', video: 'Video', audio: 'Audio', file: 'Files' } as const;
const PRESENCE_OPTIONS = [{ value: 'stored', label: 'On this PC' }, { value: 'gone', label: 'Not on this PC' }, { value: 'any', label: 'All' }];

/** The place is the rail's (PlaceRail); these narrow within it. */
export function AttachmentFilters() {
  return (
    <div class={styles.filters}>
      <SearchSelect class={styles.who} label="Who" value={who() ?? ''}
        options={[{ value: '', label: 'Anyone' }, ...people().filter((p) => p.id).map((p) => ({ value: p.id, label: p.name }))]}
        onChange={(value) => setWho(value || null)} />
      <div class={styles.kinds} role="group" aria-label="File kinds">
        <For each={ATTACHMENT_KINDS}>{(kind) => (
          <button type="button" class={`${styles.chip} ${look.chip}`} aria-pressed={kinds().includes(kind)}
            onClick={() => setKinds((old) => old.includes(kind) ? old.filter((k) => k !== kind) : [...old, kind])}>
            <Icon name={KIND_ICON[kind]} class={styles.chipIcon} />
            <span class={`${styles.chipLabel} ${look.text}`} data-size="xs">{KIND_LABEL[kind]}</span>
            <span class={look.text} data-size="2xs" data-tone="muted" data-figures="tabular">{totals().byKind[kind].count}</span>
          </button>
        )}</For>
      </div>
      <SegGroup class={styles.tool} role="radiogroup" ariaLabel="Date range" value={range()} onChange={(value: AttachmentRange) => setRange(value)}>
        <For each={Object.entries(ATTACHMENT_RANGES)}>{([id, r]) => <SegButton value={id} label={r.brief} size="sm" />}</For>
      </SegGroup>
      <Select class={styles.size} label="Minimum file size" value={String(minBytes())}
        options={MIN_SIZE_OPTIONS.map((o) => ({ ...o, value: String(o.value) }))} onChange={(value) => setMinBytes(Number(value))} />
      <Select class={styles.state} label="Storage" value={presence()} options={PRESENCE_OPTIONS} onChange={(value) => setPresence(value as AttachmentPresence)} />
      <button type="button" class={`${styles.sortButton} ${look.filterChip} ${look.text}`} data-size="xs"
        title={`Order: ${sort() === 'newest' ? 'Newest' : 'Largest'}. Click for ${sort() === 'newest' ? 'largest' : 'newest'}.`}
        onClick={() => setSort((old) => old === 'newest' ? 'largest' : 'newest')}>{sort() === 'newest' ? 'Newest' : 'Largest'}</button>
      <input type="search" class={styles.search} placeholder="File name" aria-label="File name" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      <Show when={canCompressHere}>
        <label class={`${styles.toggle} ${look.toggleLabel} ${look.text}`} data-size="xs">
          <Switch checked={uncompressed()} onChange={setUncompressed} />Can compress
        </label>
      </Show>
    </div>
  );
}
