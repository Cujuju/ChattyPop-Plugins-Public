import { createEffect, on, createSignal, type Accessor } from 'solid-js';
import { coalescedRead, desktopCoreClient, pageShown, onAppEvent, onArchiveChange, onCleanup, onEvent, pluginData } from '@plugin-sdk/renderer';
import { createPagedList } from '@plugin-sdk/renderer/kit';
import { plugin, UPDATED_EVENT } from '../shared';
import type { LinkCard, PersonLinksQuery } from '../shared/types';

/** Person cards use a short first page so the profile opens without loading the entire sharing history. */
const PERSON_LINKS_PAGE = 20;

export function createPersonLinks(userId: Accessor<string>) {
  const [failure, setFailure] = createSignal<string | null>(null);
  const page = (query: PersonLinksQuery, signal?: AbortSignal) => pluginData(() => desktopCoreClient(plugin, { signal, priority: pageShown() ? 'interactive' : 'background' }).sharedBy(query), []);
  const cursor = (row: LinkCard) => ({ ts: row.ts, id: row.id });
  const list = createPagedList<LinkCard>(PERSON_LINKS_PAGE,
    (oldest, signal) => page({ userId: userId(), limit: PERSON_LINKS_PAGE, after: cursor(oldest) }, signal), undefined,
    { newestAtStart: () => true, oldestAtEnd: true, newer: (newest, signal) => page({ userId: userId(), limit: PERSON_LINKS_PAGE, before: cursor(newest) }, signal), reload: (signal) => reload(signal) });
  const load = async (read: () => Promise<unknown>): Promise<void> => {
    try { await read(); setFailure(null); } catch (e) { setFailure(String(e)); }
  };
  let needsRead = true;
  let privacyEpoch = 0;
  const reload = coalescedRead((signal?: AbortSignal): Promise<void> => {
    if (!pageShown()) { needsRead = true; return Promise.resolve(); }
    needsRead = false;
    return load(() => list.reload(async (readSignal) => {
      const items = await page({ userId: userId(), limit: PERSON_LINKS_PAGE }, readSignal);
      return { items, reachedStart: items.length < PERSON_LINKS_PAGE };
    }, signal));
  }, () => JSON.stringify([userId(), pageShown(), privacyEpoch]));
  createEffect(on(userId, () => { list.reset(); needsRead = true; void reload(); }));
  createEffect(on(pageShown, (shown) => { if (shown && needsRead) void reload(); }, { defer: true }));
  onArchiveChange({ kinds: ['links', 'deletes', 'names'], shown: pageShown }, (change, signal) => load(() => list.applyChange(change, signal)));
  const offs = [onAppEvent('privacy-changed', () => { privacyEpoch++; list.reset(); void reload(); }), onEvent(plugin, UPDATED_EVENT, () => void reload())];
  onCleanup(() => offs.forEach((off) => off()));
  return { state: list.state, failure, older: () => load(() => list.loadOlder()) };
}
