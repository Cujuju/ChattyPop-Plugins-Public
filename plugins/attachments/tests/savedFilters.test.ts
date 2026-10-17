import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { equalFilterSnapshots, normalizeFilterSnapshot, normalizeSavedFilters } from '../shared/savedFilters';
import { FILENAME_DEBOUNCE_MS, createAttachmentFilters } from '../renderer/filterState';
import { textHighlights } from '../renderer/textHighlights';

vi.mock('solid-js', async () => { const clientBuild = 'solid-js/dist/solid.cjs'; return import(clientBuild); });

describe('saved attachment filters', () => {
  it('defensively normalizes preferences, snapshots and duplicate identities/names', () => {
    const defaults = normalizeFilterSnapshot(null);
    expect(defaults).toEqual({ place: null, who: null, kinds: [], range: 'all', minBytes: 0, presence: 'stored', uncompressed: false, name: '', sort: { key: 'date', dir: 'desc' } });
    expect(normalizeSavedFilters(null)).toEqual([]);
    const entries = normalizeSavedFilters([null, [], {}, { id: 'a', name: 'No snapshot' },
      { id: ' a ', name: ' Videos ', filters: { place: { by: 'unknown', id: 'x' }, who: [], kinds: ['video', 'bad', 'video', 'image'],
        range: '__proto__', minBytes: Infinity, presence: 'bad', uncompressed: 'true', name: '  nebula  ', sort: { key: 'bad', dir: 'bad' }, token: 'discard' } },
      { id: 'a', name: 'Other', filters: {} }, { id: 'b', name: 'videos', filters: {} },
    ]);
    expect(entries).toEqual([{ id: 'a', name: 'Videos', filters: { ...defaults, kinds: ['image', 'video'], name: 'nebula' } }]);
    expect(normalizeFilterSnapshot({ minBytes: -1, place: { by: 'channel', id: ' c ' }, who: ' bob ' })).toMatchObject({ minBytes: 0, place: { by: 'channel', id: 'c' }, who: 'bob' });
  });

  it('applies every saved field atomically, clearing pending name debounce and preserving a relative range', async () => {
    vi.useFakeTimers();
    const root = createRoot((dispose) => ({ f: createAttachmentFilters(), dispose }));
    try {
      root.f.setName('stale edit');
      const snapshot = normalizeFilterSnapshot({ place: { by: 'channel', id: 'c' }, who: 'bob', kinds: ['video', 'image'], range: '7d',
        minBytes: 100, presence: 'any', uncompressed: true, name: ' saved ', sort: { key: 'name', dir: 'asc' } });
      root.f.applySnapshot(snapshot);
      expect(root.f.snapshot()).toEqual(snapshot);
      expect(root.f.filter()).toMatchObject({ channelId: 'c', authorId: 'bob', kinds: ['image', 'video'], minBytes: 100, presence: 'any', uncompressed: true, name: 'saved' });
      await vi.advanceTimersByTimeAsync(FILENAME_DEBOUNCE_MS);
      expect(root.f.filter().name).toBe('saved');
      expect(equalFilterSnapshots(snapshot, { ...snapshot, kinds: ['video', 'image', 'video'], name: ' saved ' })).toBe(true);
      for (const difference of [{ who: null }, { place: null }, { kinds: [] }, { range: '30d' }, { minBytes: 0 }, { presence: 'gone' }, { uncompressed: false }, { name: 'other' }, { sort: { key: 'date', dir: 'asc' } }]) {
        expect(equalFilterSnapshots(snapshot, { ...snapshot, ...difference })).toBe(false);
      }
      root.f.applySnapshot(null);
      expect(root.f.filterCount()).toBe(0);
    } finally { root.dispose(); vi.useRealTimers(); }
  });
});

it('highlights every literal query occurrence without interpreting markup or regex', () => {
  expect(textHighlights('<x> A+B and a+b', 'a+b')).toEqual([
    { text: '<x> ', matched: false }, { text: 'A+B', matched: true }, { text: ' and ', matched: false }, { text: 'a+b', matched: true },
  ]);
});
