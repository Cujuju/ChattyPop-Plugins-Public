import { NEWEST, ATTACHMENT_KINDS, type AttachmentKind, type AttachmentPresence, type AttachmentSort } from './types';

const DAYS_PER_YEAR = 365;
export const ATTACHMENT_RANGES = {
  all: { brief: 'Any', days: null }, '1d': { brief: '24h', days: 1 }, '7d': { brief: '7d', days: 7 },
  '30d': { brief: '30d', days: 30 }, '1y': { brief: '1y', days: DAYS_PER_YEAR },
} as const;
export type AttachmentRange = keyof typeof ATTACHMENT_RANGES;
export type AttachmentPlace = { by: 'guild' | 'channel'; id: string } | null;
export interface AttachmentFilterSnapshot {
  place: AttachmentPlace; who: string | null; kinds: AttachmentKind[]; range: AttachmentRange; minBytes: number;
  presence: AttachmentPresence; uncompressed: boolean; repeated: boolean; name: string; sort: AttachmentSort;
}
export interface SavedAttachmentFilter { id: string; name: string; filters: AttachmentFilterSnapshot }
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const nonblank = (v: unknown): string | null => typeof v === 'string' ? v.trim() || null : null;

/** Canonical kinds and trimmed text give snapshots stable equality across preference versions. */
export function normalizeFilterSnapshot(value: unknown): AttachmentFilterSnapshot {
  const v = record(value), place = record(v.place), sort = record(v.sort);
  const placeId = nonblank(place.id);
  return {
    place: placeId && (place.by === 'guild' || place.by === 'channel') ? { by: place.by, id: placeId } : null,
    // '' is the unknown-person filter.
    who: typeof v.who === 'string' ? v.who.trim() : null, kinds: ATTACHMENT_KINDS.filter((k) => Array.isArray(v.kinds) && v.kinds.includes(k)),
    range: typeof v.range === 'string' && Object.hasOwn(ATTACHMENT_RANGES, v.range) ? v.range as AttachmentRange : 'all',
    minBytes: typeof v.minBytes === 'number' && Number.isFinite(v.minBytes) && v.minBytes > 0 ? v.minBytes : 0,
    presence: v.presence === 'any' || v.presence === 'gone' ? v.presence : 'stored', uncompressed: v.uncompressed === true, repeated: v.repeated === true,
    name: nonblank(v.name) ?? '',
    sort: { key: sort.key === 'date' || sort.key === 'size' || sort.key === 'name' || sort.key === 'kind' ? sort.key : NEWEST.key,
      dir: sort.dir === 'asc' ? 'asc' : NEWEST.dir },
  };
}

export const equalFilterSnapshots = (a: unknown, b: unknown): boolean => JSON.stringify(normalizeFilterSnapshot(a)) === JSON.stringify(normalizeFilterSnapshot(b));
export const filterNameKey = (name: string): string => name.trim().toLowerCase();

/** Invalid entries and duplicate identities/names are discarded; unknown snapshot fields cannot survive normalization. */
export function normalizeSavedFilters(value: unknown): SavedAttachmentFilter[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>(), names = new Set<string>();
  return value.flatMap((entry): SavedAttachmentFilter[] => {
    const v = record(entry), id = nonblank(v.id), name = nonblank(v.name);
    if (!id || !name || !v.filters || typeof v.filters !== 'object' || Array.isArray(v.filters) || ids.has(id) || names.has(filterNameKey(name))) return [];
    ids.add(id); names.add(filterNameKey(name));
    return [{ id, name, filters: normalizeFilterSnapshot(v.filters) }];
  });
}
