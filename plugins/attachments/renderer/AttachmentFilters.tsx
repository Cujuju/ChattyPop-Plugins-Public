import { For, Show } from 'solid-js';
import { Icon, PillNumberPicker, SearchSelect, SegButton, SegGroup, Select, Switch, canCompressHere, formatBytes, look, personOption } from '@plugin-sdk/renderer/kit';
import { HOVER_ZOOM, hoverZoomOf, type AttachmentAnchor } from '../shared';
import { ATTACHMENT_KINDS, LARGEST, NEWEST, type AttachmentKind, type AttachmentPresence, type AttachmentSort } from '../shared/types';
import {
  ATTACHMENT_RANGES, MIN_SIZE_OPTIONS, kinds, minBytes, name, people, presence, range, setKinds, setMinBytes, setName,
  setPresence, setRange, setSort, setUncompressed, setWho, sort, totals, uncompressed, who, type AttachmentRange,
  anchor, hoverZoom, setAnchor, setHoverZoom, view, where,
} from './state';
import { filesCount } from './actions';
import { KIND_ICON } from './AttachmentPicture';
import styles from './AttachmentFilters.module.css';
import { DateJump } from './DateJump';
import { SavedFilters } from './SavedFilters';

const KIND_LABEL: Record<AttachmentKind, string> = { image: 'Images', video: 'Video', audio: 'Audio', file: 'Files' };
const PRESENCE_OPTIONS = [{ value: 'stored', label: 'On this PC' }, { value: 'gone', label: 'Not on this PC' }, { value: 'any', label: 'All' }];
/** An order's name, first-to-last: the list's column headers set the others. */
const orderLabel = (s: AttachmentSort): string => ({
  date: s.dir === 'desc' ? 'Newest' : 'Oldest', size: s.dir === 'desc' ? 'Largest' : 'Smallest',
  name: s.dir === 'asc' ? 'Name A–Z' : 'Name Z–A', kind: s.dir === 'asc' ? 'Kind A–Z' : 'Kind Z–A',
})[s.key];

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
  // Names as they show in the channel the rail picked; else outside any server.
  const place = (): string | null => where()?.by === 'channel' ? where()!.id : null;
  const whoOptions = () => [{ value: '', label: 'Anyone', lead: () => <Icon name="group" /> },
    ...people().filter((p) => p.id).map((p) => personOption({ userId: p.id, channelId: place(), fallback: p.name, note: `${filesCount(p.count)} · ${formatBytes(p.bytes)}` }))];
  return (
    <div class={`${styles.filters} ${look.ruleBelow}`} data-rule="subtle">
      <SearchSelect class={styles.field} label="Who" value={who() ?? ''} options={whoOptions()} onChange={(value) => setWho(value || null)} />
      <input type="search" class={styles.field} placeholder="Name or text in files" aria-label="Search file names and text" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      <Select class={styles.select} label="Minimum file size" value={String(minBytes())}
        options={MIN_SIZE_OPTIONS.map((o) => ({ ...o, value: String(o.value) }))} onChange={(value) => setMinBytes(Number(value))} />
      <Select class={styles.select} label="Storage" value={presence()} options={PRESENCE_OPTIONS} onChange={(value) => setPresence(value as AttachmentPresence)} />
      <Show when={canCompressHere}>
        <label class={`${styles.toggle} ${look.toggleLabel} ${look.text}`} data-size="xs" data-tone="secondary" data-font="sans">
          <Switch checked={uncompressed()} onChange={setUncompressed} />Can compress
        </label>
      </Show>
      {/* View settings, not filters: Reset leaves them. */}
      <span class={`${styles.toggle} ${look.toggleLabel} ${look.text}`} data-size="xs" data-tone="secondary" data-font="sans">
        Start at
        <SegGroup role="radiogroup" ariaLabel="Start the order at" value={anchor()} onChange={(value: AttachmentAnchor) => setAnchor(value)}>
          <SegButton value="top" label="Top" size="sm" ariaLabel="Top, as a file browser: the order runs down" />
          <SegButton value="bottom" label="Bottom" size="sm" ariaLabel="Bottom, as a chat: the order runs up" />
        </SegGroup>
      </span>
      <SavedFilters />
      <DateJump />
      <Show when={view() === 'grid'}>
        {/* Not a label: a click on its words would press the picker's first button. */}
        <span class={`${styles.toggle} ${look.toggleLabel} ${look.text}`} data-size="xs" data-tone="secondary" data-font="sans"
          title="How much a picture grows under the pointer; 1 is off">
          Hover zoom
          <PillNumberPicker ariaLabel="Hover zoom" min={HOVER_ZOOM.min} max={HOVER_ZOOM.max} step={HOVER_ZOOM.step} suffix="×" requireFocus
            value={hoverZoom()} onChange={(z) => void setHoverZoom(hoverZoomOf(z))} />
        </span>
      </Show>
    </div>
  );
}
