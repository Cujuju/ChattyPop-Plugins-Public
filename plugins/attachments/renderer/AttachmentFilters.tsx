import { For, Show } from 'solid-js';
import { Icon, SearchSelect, SegButton, SegGroup, Select, Switch, canCompressHere, formatBytes, look } from '@plugin-sdk/renderer/kit';
import { HOVER_ZOOMS, type HoverZoom } from '../shared';
import { ATTACHMENT_KINDS, LARGEST, NEWEST, type AttachmentKind, type AttachmentPresence, type AttachmentSort } from '../shared/types';
import {
  ATTACHMENT_RANGES, MIN_SIZE_OPTIONS, kinds, minBytes, name, people, presence, range, setKinds, setMinBytes, setName,
  setPresence, setRange, setSort, setUncompressed, setWho, sort, totals, uncompressed, who, type AttachmentRange,
  hoverZoom, setHoverZoom, view,
} from './state';
import { filesCount } from './actions';
import { KIND_ICON } from './AttachmentPicture';
import styles from './AttachmentFilters.module.css';

const KIND_LABEL: Record<AttachmentKind, string> = { image: 'Images', video: 'Video', audio: 'Audio', file: 'Files' };
const PRESENCE_OPTIONS = [{ value: 'stored', label: 'On this PC' }, { value: 'gone', label: 'Not on this PC' }, { value: 'any', label: 'All' }];
/** An order's name, first-to-last: the list's column headers set the others. */
const orderLabel = (s: AttachmentSort): string => ({
  date: s.dir === 'desc' ? 'Newest' : 'Oldest', size: s.dir === 'desc' ? 'Largest' : 'Smallest',
  name: s.dir === 'asc' ? 'Name A–Z' : 'Name Z–A', kind: s.dir === 'asc' ? 'Kind A–Z' : 'Kind Z–A',
})[s.key];
const ZOOM_OPTIONS = HOVER_ZOOMS.map((z) => ({ value: String(z), label: z === 1 ? 'No hover zoom' : `Hover zoom ${z}×` }));

const toggleKind = (kind: AttachmentKind): void => void setKinds((old) => old.includes(kind) ? old.filter((k) => k !== kind) : [...old, kind]);

/** Header tools, as the Links header's: kind icons (name and count in the tooltip), range and order. */
export function HeaderTools() {
  const described = (kind: AttachmentKind): string => `${KIND_LABEL[kind]}, ${totals().byKind[kind].count}`;
  const other = (): AttachmentSort => sort().key === 'date' && sort().dir === 'desc' ? LARGEST : NEWEST;
  return (
    <div class={styles.tools}>
      <div class={`${styles.tool} ${styles.kinds}`} role="group" aria-label="File kinds">
        <For each={ATTACHMENT_KINDS}>{(kind) => (
          <button type="button" class={`${styles.chip} ${look.filterChip} ${look.text}`} aria-pressed={kinds().includes(kind)}
            aria-label={described(kind)} title={described(kind)} onClick={() => toggleKind(kind)}>
            <Icon name={KIND_ICON[kind]} class={styles.chipIcon} />
          </button>
        )}</For>
      </div>
      <SegGroup class={styles.tool} role="radiogroup" ariaLabel="Date range" value={range()} onChange={(value: AttachmentRange) => setRange(value)}>
        <For each={Object.entries(ATTACHMENT_RANGES)}>{([id, r]) => <SegButton value={id} label={r.brief} size="sm" />}</For>
      </SegGroup>
      <button type="button" class={`${styles.tool} ${styles.orderButton} ${look.filterChip} ${look.text}`} data-size="xs" data-font="sans"
        title={`Order: ${orderLabel(sort())}. Click for ${orderLabel(other()).toLowerCase()}.`} onClick={() => setSort(other())}>
        {orderLabel(sort())}
      </button>
    </div>
  );
}

/** The rest, under the header beside the rail: who, name, size, storage and compressibility. */
export function FilterBar() {
  const whoOptions = () => [{ value: '', label: 'Anyone' },
    ...people().filter((p) => p.id).map((p) => ({ value: p.id, label: p.name, note: `${filesCount(p.count)} · ${formatBytes(p.bytes)}` }))];
  return (
    <div class={`${styles.filters} ${look.ruleBelow}`} data-rule="subtle">
      <SearchSelect class={styles.field} label="Who" value={who() ?? ''} options={whoOptions()} onChange={(value) => setWho(value || null)} />
      <input type="search" class={styles.field} placeholder="File name" aria-label="File name" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      <Select class={styles.select} label="Minimum file size" value={String(minBytes())}
        options={MIN_SIZE_OPTIONS.map((o) => ({ ...o, value: String(o.value) }))} onChange={(value) => setMinBytes(Number(value))} />
      <Select class={styles.select} label="Storage" value={presence()} options={PRESENCE_OPTIONS} onChange={(value) => setPresence(value as AttachmentPresence)} />
      <Show when={canCompressHere}>
        <label class={`${styles.toggle} ${look.toggleLabel} ${look.text}`} data-size="xs" data-tone="secondary" data-font="sans">
          <Switch checked={uncompressed()} onChange={setUncompressed} />Can compress
        </label>
      </Show>
      {/* A view setting, not a filter: Reset leaves it. */}
      <Show when={view() === 'grid'}>
        <Select class={styles.select} label="Hover zoom" value={String(hoverZoom())} options={ZOOM_OPTIONS}
          onChange={(value) => setHoverZoom(Number(value) as HoverZoom)} />
      </Show>
    </div>
  );
}
