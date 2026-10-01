// The Links panel's loaded feed: a refresh begun before a privacy reload never lands after it.
import { describe, expect, it, vi } from 'vitest';
import type { LinkItem } from '../shared/types';
import type { PagedState } from '@/state/paged';

/** A core call the test answers when it chooses. */
interface Pending<T> {
  resolve(value: T): void;
}

const env = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  pages: [] as Pending<LinkItem[]>[],
  partsChanged: null as ((ids: string[] | null) => void) | null,
}));

vi.mock('@plugin-sdk/renderer/kit', async () => ({ createPagedList: (await import('@/state/paged')).createPagedList }));
vi.mock('@plugin-sdk/renderer', async () => ({
  ARCHIVE_REFRESH_DEBOUNCE_MS: 0,
  callable: () => true,
  desktopCoreClient: () => ({
    page: () => new Promise<LinkItem[]>((resolve) => env.pages.push({ resolve })),
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
const { links, reloadLinks } = (await import(statePath)) as { links: PagedState<LinkItem>; reloadLinks(): Promise<void> };
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
    expect(env.pages).toEqual([]);
    env.partsChanged?.([publicLink.messageId]);
    expect(env.pages.length).toBe(1);
    env.pages.shift()!.resolve([privateLink, tagged]);
    await settle();
    expect(links.items.map((i) => i.message)).toEqual([tagged.message, null]);
  });
});
