import { createEffect, on, createSignal, type Accessor } from 'solid-js';
import { coalescedRead, desktopCoreClient, pageShown, onAppEvent, onArchiveChange, onCleanup, pluginData } from '@plugin-sdk/renderer';
import { createPagedList } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import type { AttachmentItem, PersonFilesQuery } from '../shared/types';
import { PERSON_FILES_PAGE } from './filterState';

/** A mounted Person Files tab pages older rows and catches up strictly past its newest cursor. */
export function createPersonFiles(userId: Accessor<string>) {
  const client = desktopCoreClient(plugin);
  const [failure, setFailure] = createSignal<string | null>(null);
  const page = (query: PersonFilesQuery) => pluginData(() => client.sharedBy(query), []);
  const cursor = (row: AttachmentItem) => ({ ts: row.ts, id: row.id });
  const list = createPagedList<AttachmentItem>(PERSON_FILES_PAGE,
    (oldest) => page({ userId: userId(), limit: PERSON_FILES_PAGE, after: cursor(oldest) }), undefined,
    { newestAtStart: () => true, oldestAtEnd: true, newer: (newest) => page({ userId: userId(), limit: PERSON_FILES_PAGE, before: cursor(newest) }), reload: () => reload() });
  const load = async (read: () => Promise<unknown>): Promise<void> => {
    try { await read(); setFailure(null); } catch (e) { setFailure(String(e)); }
  };
  let needsRead = true;
  let privacyEpoch = 0;
  const reload = coalescedRead((): Promise<void> => {
    if (!pageShown()) { needsRead = true; return Promise.resolve(); }
    needsRead = false;
    return load(() => list.reload(async () => {
      const items = await page({ userId: userId(), limit: PERSON_FILES_PAGE });
      return { items, reachedStart: items.length < PERSON_FILES_PAGE };
    }));
  }, () => JSON.stringify([userId(), pageShown(), privacyEpoch]));
  createEffect(on(userId, () => { list.reset(); needsRead = true; void reload(); }));
  createEffect(on(pageShown, (shown) => { if (shown && needsRead) void reload(); }, { defer: true }));
  onArchiveChange({ kinds: ['attachments', 'deletes', 'names'], shown: pageShown }, (change) => load(() => list.applyChange(change)));
  const off = onAppEvent('privacy-changed', () => { privacyEpoch++; list.reset(); void reload(); });
  onCleanup(off);
  return { state: list.state, failure, reload, older: () => load(() => list.loadOlder()) };
}
