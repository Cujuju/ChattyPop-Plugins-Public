import { batch, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import type { AttachmentFilter, AttachmentKind, AttachmentPresence, AttachmentSort } from '../shared/types';

export const ATTACHMENT_PAGE_SIZE = 100;
export const WHO_OPTIONS_MAX = 200;
export const BREAKDOWN_ROWS = 10;
export const PERSON_FILES_PAGE = 40;
export const FILENAME_DEBOUNCE_MS = 250;
const BYTES_PER_MB = 1_000_000;
const DAYS_PER_YEAR = 365;
export const ATTACHMENT_RANGES = {
  all: { brief: 'Any', days: null }, '1d': { brief: '24h', days: 1 }, '7d': { brief: '7d', days: 7 },
  '30d': { brief: '30d', days: 30 }, '1y': { brief: '1y', days: DAYS_PER_YEAR },
} as const;
export type AttachmentRange = keyof typeof ATTACHMENT_RANGES;
export const MIN_SIZE_OPTIONS = [
  { value: 0, label: 'Any size' }, { value: BYTES_PER_MB, label: '1 MB' },
  { value: 10 * BYTES_PER_MB, label: '10 MB' }, { value: 100 * BYTES_PER_MB, label: '100 MB' },
];
export type Where = { by: 'guild' | 'channel'; id: string } | null;

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
  const [sort, setSort] = createSignal<AttachmentSort>('newest');
  const filterCount = (): number => [where() !== null, who() !== null, kinds().length > 0, range() !== 'all', minBytes() > 0,
    presence() !== 'stored', uncompressed(), name().trim().length > 0, sort() !== 'newest'].filter(Boolean).length;
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(name, (value) => {
    clearTimeout(timer);
    timer = setTimeout(() => setQueryName(value.trim()), FILENAME_DEBOUNCE_MS);
  }));
  onCleanup(() => clearTimeout(timer));
  const resetFilters = (): void => {
    clearTimeout(timer);
    batch(() => {
      setWhere(null); setWho(null); setKinds([]); setRange('all'); setMinBytes(0); setPresence('stored');
      setUncompressed(false); setName(''); setQueryName(''); setSort('newest');
    });
  };
  const filter = (): AttachmentFilter => {
    const scope = where();
    const days = ATTACHMENT_RANGES[range()].days;
    return {
      ...(scope ? { [scope.by === 'guild' ? 'guildId' : 'channelId']: scope.id } : {}),
      ...(who() ? { authorId: who()! } : {}), ...(kinds().length ? { kinds: kinds() } : {}),
      ...(days !== null ? { sinceTs: Date.now() - days * MS_PER_DAY } : {}),
      ...(minBytes() ? { minBytes: minBytes() } : {}), presence: presence(), uncompressed: uncompressed(),
      ...(queryName() ? { name: queryName() } : {}),
    };
  };
  return { where, setWhere, who, setWho, kinds, setKinds, range, setRange, minBytes, setMinBytes, presence, setPresence,
    uncompressed, setUncompressed, name, setName, queryName, sort, setSort, filter, filterCount, resetFilters };
}
