// The Links panel's loaded feed: refreshes never land after a newer reload, and reloads the owner didn't ask for keep their place.
import { describe, expect, it, vi } from 'vitest';
import type { LinkItem, LinkPlace, LinkWindow, LinkWindowQuery } from '../shared/types';
import type { PagedState } from '@/state/paged';

/** A core call the test answers when it chooses. */
interface Pending<T> {
  resolve(value: T): void;
}

const env = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  pages: [] as Pending<LinkItem[]>[],
  windows: [] as (Pending<LinkWindow> & { query: LinkWindowQuery })[],
  partsChanged: null as ((ids: string[] | null) => void) | null,
}));

vi.mock('@plugin-sdk/renderer/kit', async () => ({ createPagedList: (await import('@/state/paged')).createPagedList }));
vi.mock('@plugin-sdk/renderer', async () => ({
  ARCHIVE_REFRESH_DEBOUNCE_MS: 0,
  callable: () => true,
  coreClient: () => ({
    page: () => new Promise<LinkItem[]>((resolve) => env.pages.push({ resolve })),
    window: (query: LinkWindowQuery) => new Promise<LinkWindow>((resolve) => env.windows.push({ resolve, query })),
    counts: async () => ({}),
  }),
  pluginData: (await import('@plugin-sdk/renderer/data')).pluginData,
  pluginPreference: () => [() => 0, () => undefined, { loaded: Promise.resolve() }],
  lastSeenAt: async () => 0,
  onAppEvent: (type: string, fn: () => void) => void env.handlers.set(type, fn),
  onAppEventDebounced: (type: string, _ms: number, fn: () => void) => void env.handlers.set(type, fn),
  onEvent: (_plugin: unknown, name: string, fn: () => void) => void env.handlers.set(name, fn),
  onMessagePartsChanged: (fn: (ids: string[] | null) => void) => void (env.partsChanged = fn),
}));

// A renderer module: imported by path so the node type-check doesn't follow it.
const statePath = '../renderer/state.ts';
const state = (await import(statePath)) as {
  links: PagedState<LinkItem>;
  reloadLinks(place?: LinkPlace | null): Promise<void>;
  linkAtNewest(): boolean;
  linkOpening(): { place: LinkPlace; anchorId: number | null } | null;
  readLinkPlaceWith(read: () => LinkPlace | undefined): () => void;
};
const { links, reloadLinks } = state;
const { createPagedList } = await import('@/state/paged');

const item = (id: number, url: string): LinkItem => ({
  id, url, platform: 'other', title: null, description: null, thumbnailUrl: null, site: null, ts: id, messageId: String(id),
  channelId: 'c', channelName: 'c', guildName: '', authorName: 'a', shares: 1, embed: null, message: null, category: null,
  flagged: false, worth: null,
}) as LinkItem;
const publicLink = item(1, 'https://public.example');
const privateLink = item(2, 'https://private.example');
/** Lets awaited continuations run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('Links feed', () => {
  it('drops a refresh that a privacy reload superseded', async () => {
    const first = reloadLinks();
    env.pages.shift()!.resolve([privateLink, publicLink]);
    await first;
    expect(links.items.map((i) => i.url)).toEqual([publicLink.url, privateLink.url]);

    env.handlers.get('archive-changed')!();
    const staleRefresh = env.pages.shift()!;
    env.handlers.get('privacy-changed')!();
    await settle();
    env.pages.shift()!.resolve([publicLink]);
    await settle();
    expect(links.items.map((i) => i.url)).toEqual([publicLink.url]);

    staleRefresh.resolve([privateLink, publicLink]);
    await settle();
    expect(links.items.map((i) => i.url)).toEqual([publicLink.url]);
  });

  it('never lets an earlier-started update overwrite a later one', async () => {
    const list = createPagedList<LinkItem>(1, async () => []);
    let answerFirst: (items: LinkItem[]) => void = () => undefined;
    const first = list.update(() => new Promise<LinkItem[]>((resolve) => { answerFirst = resolve; }), (items) => items);
    expect(await list.update(async () => [publicLink], (items) => items)).toBe(true);
    answerFirst([privateLink]);
    expect(await first).toBe(false);
    expect(list.state.items.map((i) => i.url)).toEqual([publicLink.url]);
  });

  it("re-reads loaded links in place when their messages' plugin parts change", async () => {
    const load = reloadLinks();
    env.pages.shift()!.resolve([privateLink, publicLink]);
    await load;
    const tagged = { ...publicLink, message: { labels: [{ subject: 'usertag:1', text: 'salary', title: '', pluginId: 'tags' }] } } as unknown as LinkItem;

    env.partsChanged?.(['999']);
    expect(env.windows).toEqual([]);
    env.partsChanged?.([publicLink.messageId]);
    // The loaded stretch: from the oldest loaded link up through the rest.
    const read = env.windows.shift()!;
    expect(read.query).toMatchObject({ around: { ts: publicLink.ts, id: publicLink.id }, newer: 1, older: 1 });
    read.resolve({ items: [privateLink, tagged], reachesNewest: true, reachedStart: true, anchorId: publicLink.id });
    await settle();
    expect(links.items.map((i) => i.message)).toEqual([tagged.message, null]);
  });

  it('opens around a place, and new links wait for paging down to them', async () => {
    const place: LinkPlace = { ts: publicLink.ts, id: publicLink.id, bottom: 40 };
    const open = reloadLinks(place);
    const read = env.windows.shift()!;
    expect(read.query).toMatchObject({ around: { ts: place.ts, id: place.id }, newer: 50, older: 50 });
    read.resolve({ items: [privateLink, publicLink], reachesNewest: false, reachedStart: true, anchorId: publicLink.id });
    await open;
    expect(state.linkAtNewest()).toBe(false);
    expect(state.linkOpening()).toEqual({ place, anchorId: publicLink.id });

    // An arrival re-reads the loaded links in place; it doesn't append the newest page past a gap.
    env.handlers.get('archive-changed')!();
    expect(env.pages).toEqual([]);
    env.windows.shift()!.resolve({ items: [privateLink, publicLink], reachesNewest: false, reachedStart: true, anchorId: publicLink.id });
    await settle();
    expect(links.items.map((i) => i.id)).toEqual([publicLink.id, privateLink.id]);
  });

  it('reloads a privacy change where the owner is', async () => {
    const place: LinkPlace = { ts: privateLink.ts, id: privateLink.id, bottom: 0 };
    const stop = state.readLinkPlaceWith(() => place);
    try {
      env.handlers.get('privacy-changed')!();
      await settle();
      expect(env.pages).toEqual([]);
      const read = env.windows.shift()!;
      expect(read.query.around).toEqual({ ts: place.ts, id: place.id });
      read.resolve({ items: [publicLink], reachesNewest: true, reachedStart: true, anchorId: publicLink.id });
      await settle();
      expect(state.linkOpening()).toEqual({ place, anchorId: publicLink.id });
      expect(state.linkAtNewest()).toBe(true);
    } finally {
      stop();
    }
  });
});
