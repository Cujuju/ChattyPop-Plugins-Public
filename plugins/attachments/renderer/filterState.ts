import { batch, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { BYTES_PER_MB, MS_PER_DAY } from '@plugin-sdk/shared';
import { NEWEST, type AttachmentFilter, type AttachmentKind, type AttachmentPresence, type AttachmentSort } from '../shared/types';
import { ATTACHMENT_RANGES, normalizeFilterSnapshot, type AttachmentFilterSnapshot, type AttachmentPlace, type AttachmentRange } from '../shared/savedFilters';
export { ATTACHMENT_RANGES, type AttachmentRange } from '../shared/savedFilters';

export const ATTACHMENT_PAGE_SIZE = 100;
export const WHO_OPTIONS_MAX = 200;
export const PERSON_FILES_PAGE = 40;
export const FILENAME_DEBOUNCE_MS = 250;
export const MIN_SIZE_OPTIONS = [
  { value: 0, label: 'Any size' }, { value: BYTES_PER_MB, label: '1 MB' },
  { value: 10 * BYTES_PER_MB, label: '10 MB' }, { value: 100 * BYTES_PER_MB, label: '100 MB' },
];
export type Where = AttachmentPlace;

/** Filter signals and debounce are independent of host UI, so tests exercise the same state the panel uses. */
export function createAttachmentFilters() {
  const [where, setWhere] = createSignal<Where>(null);
  const [who, setWho] = createSignal<string | null>(null);
  const [kinds, setKinds] = createSignal<AttachmentKind[]>([]);
  const [range, setRange] = createSignal<AttachmentRange>('all');
  const [minBytes, setMinBytes] = createSignal(0);
  const [presence, setPresence] = createSignal<AttachmentPresence>('stored');
  const [uncompressed, setUncompressed] = createSignal(false);
  const [name, setName] = createSignal('');
  const [queryName, setQueryName] = createSignal('');
  const [sort, setSort] = createSignal<AttachmentSort>(NEWEST);
  const filterCount = (): number => [where() !== null, who() !== null, kinds().length > 0, range() !== 'all', minBytes() > 0,
    presence() !== 'stored', uncompressed(), name().trim().length > 0, sort().key !== NEWEST.key || sort().dir !== NEWEST.dir].filter(Boolean).length;
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(name, (value) => {
    clearTimeout(timer);
    timer = setTimeout(() => setQueryName(value.trim()), FILENAME_DEBOUNCE_MS);
  }));
  onCleanup(() => clearTimeout(timer));
  const snapshot = (): AttachmentFilterSnapshot => normalizeFilterSnapshot({ place: where(), who: who(), kinds: kinds(), range: range(),
    minBytes: minBytes(), presence: presence(), uncompressed: uncompressed(), name: name(), sort: sort() });
  const applySnapshot = (value: unknown): void => {
    const s = normalizeFilterSnapshot(value);
    clearTimeout(timer);
    batch(() => {
      setWhere(s.place); setWho(s.who); setKinds(s.kinds); setRange(s.range); setMinBytes(s.minBytes); setPresence(s.presence);
      setUncompressed(s.uncompressed); setName(s.name); setQueryName(s.name); setSort(s.sort);
    });
  };
  const resetFilters = (): void => {
    clearTimeout(timer);
    batch(() => {
      setWhere(null); setWho(null); setKinds([]); setRange('all'); setMinBytes(0); setPresence('stored');
      setUncompressed(false); setName(''); setQueryName(''); setSort(NEWEST);
    });
  };
  /** Every filter but the place (where): what the rail counts under. */
  const unplaced = (): AttachmentFilter => {
    const days = ATTACHMENT_RANGES[range()].days;
    return {
      ...(who() ? { authorId: who()! } : {}), ...(kinds().length ? { kinds: kinds() } : {}),
      ...(days !== null ? { sinceTs: Date.now() - days * MS_PER_DAY } : {}),
      ...(minBytes() ? { minBytes: minBytes() } : {}), presence: presence(), uncompressed: uncompressed(),
      ...(queryName() ? { name: queryName() } : {}),
    };
  };
  const filter = (): AttachmentFilter => {
    const scope = where();
    return { ...(scope ? { [scope.by === 'guild' ? 'guildId' : 'channelId']: scope.id } : {}), ...unplaced() };
  };
  return { where, setWhere, who, setWho, kinds, setKinds, range, setRange, minBytes, setMinBytes, presence, setPresence,
    uncompressed, setUncompressed, name, setName, queryName, sort, setSort, filter, unplaced, filterCount, resetFilters, snapshot, applySnapshot };
}
