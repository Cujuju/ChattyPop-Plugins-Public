import { batch, createEffect, createSignal, on } from 'solid-js';
import { ARCHIVE_REFRESH_DEBOUNCE_MS, callable, desktopCoreClient, onAppEvent, onAppEventDebounced, pluginData, pluginPreference, pluginResource } from '@plugin-sdk/renderer';
import { createPagedList } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import { emptyTotals, type AttachmentCursor, type AttachmentItem, type BreakdownRow } from '../shared/types';
import { selection } from './selection';
import { ATTACHMENT_PAGE_SIZE, WHO_OPTIONS_MAX, createAttachmentFilters } from './filterState';
export * from './filterState';

export const { where, setWhere, who, setWho, kinds, setKinds, range, setRange, minBytes, setMinBytes, presence, setPresence,
  uncompressed, setUncompressed, name, setName, sort, setSort, filter, filterCount, resetFilters, queryName } = createAttachmentFilters();
export const [view, setView] = pluginPreference(plugin, 'view');
export const [breakdownShown, setBreakdownShown] = pluginPreference(plugin, 'breakdown');
export const [breakdownBy, setBreakdownBy] = createSignal<'guild' | 'channel' | 'author'>('guild');

const client = desktopCoreClient(plugin);
const page = (q: Parameters<typeof client.page>[0]) => pluginData(() => client.page(q), []);
const oldestFirst = (items: AttachmentItem[]): AttachmentItem[] => [...items].reverse();
export const cursorAt = (item: AttachmentItem): AttachmentCursor => ({ ts: item.ts, id: item.id, ...(sort() === 'largest' ? { bytes: item.sortBytes } : {}) });
const list = createPagedList<AttachmentItem>(ATTACHMENT_PAGE_SIZE,
  async (oldest) => oldestFirst(await page({ ...filter(), sort: sort(), limit: ATTACHMENT_PAGE_SIZE, after: cursorAt(oldest) })),
);
export const attachments = list.state;
export const loadOlderAttachments = (): Promise<number> => list.loadOlder().catch((e: unknown) => { setFailure(String(e)); return 0; });
export const [totals, setTotals] = createSignal(emptyTotals());
export const [loads, setLoads] = createSignal(0);
export const [failure, setFailure] = createSignal<string | null>(null);
const [revision, setRevision] = createSignal(0);

export const people = pluginResource(plugin, 'breakdown', () => {
  revision();
  return [{ ...filter(), authorId: undefined, by: 'author' as const, limit: WHO_OPTIONS_MAX }];
}, [] as BreakdownRow[]);
let reloadGeneration = 0;

/** Filter changes open at the newest; archive changes reread the loaded span without requesting a scroll jump. */
export async function reloadAttachments(openAtNewest = true): Promise<void> {
  const generation = ++reloadGeneration;
  const f = filter();
  const order = sort();
  const limit = openAtNewest ? ATTACHMENT_PAGE_SIZE : Math.max(ATTACHMENT_PAGE_SIZE, attachments.items.length);
  try {
    let counts = emptyTotals();
    const applied = await list.reload(async () => {
      const [items, readTotals] = await Promise.all([page({ ...f, sort: order, limit }), pluginData(() => client.totals(f), emptyTotals())]);
      counts = readTotals;
      return { items: oldestFirst(items), reachedStart: items.length < limit };
    });
    if (!applied) return;
    batch(() => { setTotals(counts); setFailure(null); setRevision((n) => n + 1); if (openAtNewest) setLoads((n) => n + 1); });
  } catch (error) { if (generation === reloadGeneration) setFailure(String(error)); }
}

export const breakdownRevision = revision;
createEffect(() => selection.retain(attachments.items));
createEffect(on([where, who, kinds, range, minBytes, presence, uncompressed, queryName, sort, () => callable(plugin, 'page')],
  () => void reloadAttachments(), { defer: true }));
onAppEventDebounced('archive-changed', ARCHIVE_REFRESH_DEBOUNCE_MS, () => void reloadAttachments(false));
onAppEvent('privacy-changed', () => {
  selection.clear();
  list.setItems([]);
  setTotals(emptyTotals());
  void reloadAttachments(false);
});
