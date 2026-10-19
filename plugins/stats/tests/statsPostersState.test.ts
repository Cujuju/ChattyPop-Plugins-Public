import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityQuery, PostersQuery, StatsPoster } from '../shared/types';
import { POSTERS_PAGE_SIZE } from '../shared/types';

interface PendingPage {
  query: PostersQuery;
  resolve(page: StatsPoster[]): void;
  reject(error: Error): void;
}

const env = vi.hoisted(() => ({
  pending: [] as PendingPage[],
  events: new Map<string, () => void>(),
  choices: new Map<string, (value: unknown) => void>(),
  setChannel: (_value: string | null): void => { throw new Error('Channel signal not initialized.'); },
}));

vi.mock('solid-js', () => { const client = 'solid-js/dist/solid.js'; return import(client); });
vi.mock('@plugin-sdk/renderer', async () => {
  const { createSignal } = await import('solid-js');
  return {
    ...(await import('@plugin-sdk/renderer/containment')),
    panelShown: () => () => true,
    visibilitySignal: (await import('@plugin-sdk/renderer/visibilitySignal')).visibilitySignal,
    callable: () => true,
    coreClient: () => ({ postersPage: (query: PostersQuery) => new Promise<StatsPoster[]>((resolve, reject) => env.pending.push({ query, resolve, reject }))
      .then((data) => ({ data, building: false, done: 1, total: 1 })) }),
    onAppEvent: (name: string, handler: () => void) => env.events.set(name, handler),
    pluginData: (await import('@plugin-sdk/renderer/data')).pluginData,
    pluginPreference: (_plugin: unknown, name: string) => {
      const [value, setValue] = createSignal<unknown>(name === 'place' ? null : name === 'channelsHidden' ? false : '30d');
      env.choices.set(name, setValue);
      return [value, setValue];
    },
    pluginResource: () => Object.assign(() => null, { loading: false, failure: null, refetch: async () => undefined, mutate: () => undefined }),
  };
});
vi.mock('@plugin-sdk/renderer/kit', async () => {
  const { createSignal } = await import('solid-js');
  const [channel, setChannel] = createSignal<string | null>('c1');
  env.setChannel = setChannel;
  return { shownChannelId: channel, isPanelCollapsed: () => false, directory: () => [], isThread: () => false };
});

const statePath = '../renderer/state.ts';
const state = await import(statePath) as {
  createPosterList(): PosterPages;
};
const pagesPath = '../renderer/posterPages.ts';
const paging = await import(pagesPath) as {
  createPosterPages(read: (q: PostersQuery) => Promise<StatsPoster[]>): PosterPages;
};
interface PosterPages {
  expanded(): boolean;
  items(): StatsPoster[];
  loading(): boolean;
  failure(): string | null;
  reachedEnd(): boolean;
  showAll(q: ActivityQuery): Promise<void>;
  loadMore(q: ActivityQuery): Promise<void>;
  reset(): void;
}

const { createRoot } = await import('solid-js');
const CHANNEL: ActivityQuery = { scope: 'channel', channelId: 'c1', sinceTs: 0 };
const NEXT_CHANNEL: ActivityQuery = { ...CHANNEL, channelId: 'c2' };
const poster = (index: number): StatsPoster => ({ userId: String(index), name: `Person ${index}`, avatar: null, count: POSTERS_PAGE_SIZE - index });
const FIRST_PAGE = Array.from({ length: POSTERS_PAGE_SIZE }, (_, index) => poster(index));
const disposals: (() => void)[] = [];
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));
const pages = () => paging.createPosterPages((query) => new Promise<StatsPoster[]>((resolve, reject) => env.pending.push({ query, resolve, reject })));

afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  env.pending.length = 0;
});

describe('ranked poster pages', () => {
  it('reads on demand, appends offset pages and ends after a short page', async () => {
    const list = pages();
    expect(env.pending).toEqual([]);
    const opening = list.showAll(CHANNEL);
    expect(env.pending[0]!.query).toEqual({ ...CHANNEL, offset: 0, limit: POSTERS_PAGE_SIZE });
    env.pending.shift()!.resolve(FIRST_PAGE);
    await opening;
    expect(list.reachedEnd()).toBe(false);
    const more = list.loadMore(CHANNEL);
    expect(env.pending[0]!.query.offset).toBe(POSTERS_PAGE_SIZE);
    const last = poster(POSTERS_PAGE_SIZE);
    env.pending.shift()!.resolve([last]);
    await more;
    expect(list.items()).toEqual([...FIRST_PAGE, last]);
    expect(list.reachedEnd()).toBe(true);
    await list.loadMore(CHANNEL);
    expect(env.pending).toEqual([]);
  });

  it('discards late pages and keeps a newer read loading after a reset', async () => {
    const list = pages();
    const old = list.showAll(CHANNEL);
    const stale = env.pending.shift()!;
    list.reset();
    expect(list.expanded()).toBe(false);
    const fresh = list.showAll(NEXT_CHANNEL);
    stale.resolve(FIRST_PAGE);
    await old;
    expect(list.items()).toEqual([]);
    expect(list.loading()).toBe(true);
    env.pending.shift()!.resolve([poster(0)]);
    await fresh;
    expect(list.items()).toEqual([poster(0)]);
    expect(list.loading()).toBe(false);
  });

  it('retains rows after failure, retries the same offset and ignores duplicate load requests', async () => {
    const list = pages();
    const first = list.showAll(CHANNEL);
    env.pending.shift()!.resolve(FIRST_PAGE);
    await first;
    const broken = list.loadMore(CHANNEL);
    await list.loadMore(CHANNEL);
    expect(env.pending).toHaveLength(1);
    env.pending.shift()!.reject(new Error('offline'));
    await broken;
    expect(list.items()).toEqual(FIRST_PAGE);
    expect(list.failure()).toBe('offline');
    const retry = list.loadMore(CHANNEL);
    expect(env.pending[0]!.query.offset).toBe(POSTERS_PAGE_SIZE);
    env.pending.shift()!.resolve([]);
    await retry;
    expect(list.failure()).toBeNull();
    expect(list.reachedEnd()).toBe(true);
  });

  it.each(['place', 'range', 'channel', 'privacy'])('resets expansion and pending rows on %s changes', async (change) => {
    env.choices.get('place')!(null);
    env.choices.get('range')!('30d');
    env.setChannel('c1');
    const list = createRoot((dispose) => { disposals.push(dispose); return state.createPosterList(); });
    await settle();
    const opening = list.showAll(CHANNEL);
    const stale = env.pending.shift()!;
    if (change === 'place') env.choices.get('place')!('all');
    if (change === 'range') env.choices.get('range')!('all');
    if (change === 'channel') env.setChannel('c2');
    if (change === 'privacy') env.events.get('privacy-changed')!();
    await settle();
    expect(list.expanded()).toBe(false);
    stale.resolve(FIRST_PAGE);
    await opening;
    expect(list.items()).toEqual([]);
    expect(list.loading()).toBe(false);
  });
});
