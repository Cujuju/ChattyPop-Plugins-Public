// The panel's rows over the paged list: where the order starts (top or bottom), loading more, and archive rereads.
import { batch, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { AttachmentAnchor } from '../shared';
import type { AttachmentItem, AttachmentPageQuery, AttachmentSort } from '../shared/types';
import type { PagedState } from '@/state/paged';

vi.mock('solid-js', async () => { const clientBuild = 'solid-js/dist/solid.cjs'; return import(clientBuild); });

const PAGE = vi.hoisted(() => 100);
type Request = { q: AttachmentPageQuery; resolve: (rows: AttachmentItem[]) => void };
const requests: Request[] = [];
vi.mock('@plugin-sdk/renderer', async () => ({
  ...(await import('@plugin-sdk/renderer/containment')),
  ARCHIVE_REFRESH_DEBOUNCE_MS: 0,
  callable: () => true,
  desktopCoreClient: () => ({
    page: (q: AttachmentPageQuery) => new Promise<AttachmentItem[]>((resolve) => requests.push({ q, resolve })),
    totals: async () => ({ byKind: {}, count: 0, bytes: 0 }),
  }),
  pluginData: (read: () => Promise<unknown>) => read(),
  pluginPreference: (_plugin: unknown, name: string) => createSignal<unknown>(name === 'anchor' ? 'bottom' : undefined),
  pluginResource: () => Object.assign(() => [], { refetch: () => undefined }),
  onAppEvent: () => () => undefined,
  onAppEventDebounced: () => () => undefined,
}));
vi.mock('@plugin-sdk/renderer/kit', async () => ({ createPagedList: (await import('@/state/paged')).createPagedList }));
vi.mock('../renderer/selection', () => ({ selection: { retain: () => undefined, clear: () => undefined } }));
vi.mock('../renderer/filterState', async (real) => ({ ...(await real<object>()), ATTACHMENT_PAGE_SIZE: PAGE }));

// A renderer module: imported by path so the node type-check doesn't follow it.
const statePath = '../renderer/state.ts';
const state = (await import(statePath)) as {
  attachments: PagedState<AttachmentItem>;
  reloadAttachments(): Promise<void>;
  rereadAttachments(): Promise<void>;
  loadOlderAttachments(): Promise<number>;
  loadMoreBelow(): Promise<number>;
  hasMoreBelow(): boolean;
  setAnchor(anchor: AttachmentAnchor): void;
  setSort(sort: AttachmentSort): void;
  jumpToMonth(month: string): Promise<void>;
  jumped(): boolean;
};
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
/** `n` rows of the order from its `from`th, as core returns them: first in the order first. */
const rows = (from: number, n: number): AttachmentItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(from + i), ts: from + i, sortBytes: from + i, filename: String(from + i), kind: 'image' }) as AttachmentItem);
const answer = async (r: AttachmentItem[]): Promise<void> => { requests.shift()!.resolve(r); await settle(); };
const ids = (): string[] => state.attachments.items.map((i) => i.id);

describe('where the order starts', () => {
  it('from the bottom, as a chat: its first row last, more loading above after the top row', async () => {
    const opened = state.reloadAttachments();
    await answer(rows(0, PAGE));
    await opened;
    expect(ids().slice(-2)).toEqual(['1', '0']);
    void state.loadOlderAttachments();
    expect(requests[0]!.q.after?.id).toBe(String(PAGE - 1));
    await answer(rows(PAGE, 1));
    expect(ids()[0]).toBe(String(PAGE));
    expect(state.hasMoreBelow()).toBe(false);
  });

  it('from the top, as a file browser: the order as read, more loading below after the bottom row', async () => {
    state.setAnchor('top');
    await settle();
    await answer(rows(0, PAGE));
    expect(ids().slice(0, 2)).toEqual(['0', '1']);
    expect(state.attachments.reachedStart).toBe(true);
    expect(state.hasMoreBelow()).toBe(true);
    void state.loadMoreBelow();
    expect(requests[0]!.q.after?.id).toBe(String(PAGE - 1));
    await answer(rows(PAGE, 1));
    expect(ids().at(-1)).toBe(String(PAGE));
    expect(state.hasMoreBelow()).toBe(false);
    state.setAnchor('bottom');
    await settle();
    await answer(rows(0, PAGE));
  });
});

describe('an archive reread', () => {
  it('reopens loading once the order grows past a span that had reached its end', async () => {
    const opened = state.reloadAttachments();
    await answer(rows(0, PAGE - 1));
    await opened;
    expect(state.attachments.reachedStart).toBe(true);
    const reread = state.rereadAttachments();
    await answer(rows(0, PAGE));
    await reread;
    expect(state.attachments.reachedStart).toBe(false);
  });

  it('keeps a page loaded while it read, reading again over the wider span', async () => {
    const opened = state.reloadAttachments();
    await answer(rows(0, PAGE));
    await opened;
    const older = state.loadOlderAttachments();
    const olderRequest = requests.shift()!;
    const reread = state.rereadAttachments();
    olderRequest.resolve(rows(PAGE, PAGE));
    await older;
    await answer(rows(0, PAGE));
    await reread;
    expect(ids()).toHaveLength(2 * PAGE);
    expect(requests[0]!.q.limit).toBe(2 * PAGE);
    await answer(rows(0, 2 * PAGE));
    expect(ids()).toHaveLength(2 * PAGE);
  });
});

describe('a date window', () => {
  it.each([
    ['asc', 'top'], ['desc', 'top'], ['asc', 'bottom'], ['desc', 'bottom'],
  ] as const)('loads both directions in %s order from the %s', async (dir, anchor) => {
    batch(() => { state.setAnchor(anchor); state.setSort({ key: 'date', dir }); });
    await settle();
    await answer(rows(0, PAGE));
    const jumped = state.jumpToMonth('2026-02');
    expect(requests[0]!.q).toMatchObject({ startMonth: '2026-02', sort: { key: 'date', dir } });
    await answer(rows(PAGE, PAGE));
    expect(requests[0]!.q.before?.id).toBe(String(PAGE));
    await answer(rows(PAGE - 1, 1));
    await jumped;
    expect(state.jumped()).toBe(true);
    expect(state.attachments.reachedStart).toBe(false);
    expect(state.hasMoreBelow()).toBe(true);
    expect(ids()[anchor === 'top' ? 0 : ids().length - 1]).toBe(String(PAGE));
    const above = state.loadOlderAttachments();
    expect(requests[0]!.q[anchor === 'top' ? 'before' : 'after']?.id).toBe(String(anchor === 'top' ? PAGE : 2 * PAGE - 1));
    await answer(anchor === 'top' ? rows(0, PAGE) : rows(2 * PAGE, PAGE));
    await above;
    const below = state.loadMoreBelow();
    expect(requests[0]!.q[anchor === 'top' ? 'after' : 'before']?.id).toBe(String(anchor === 'top' ? 2 * PAGE - 1 : PAGE));
    await answer([]);
    await below;
    expect(state.hasMoreBelow()).toBe(false);
    const reread = state.rereadAttachments();
    expect(requests[0]!.q.startAt?.id).toBe(String(anchor === 'top' ? 0 : PAGE));
    expect(requests[0]!.q.startMonth).toBeUndefined();
    await answer(rows(anchor === 'top' ? 0 : PAGE, 2 * PAGE));
    await answer([]);
    await reread;
    const reset = state.reloadAttachments();
    expect(requests[0]!.q.startMonth).toBeUndefined();
    expect(requests[0]!.q.startAt).toBeUndefined();
    await answer(rows(0, PAGE));
    await reset;
    expect(state.jumped()).toBe(false);
  });

  it.each(['top', 'bottom'] as const)('keeps the return direction open for a short window from the %s', async (anchor) => {
    batch(() => { state.setAnchor(anchor); state.setSort({ key: 'date', dir: 'desc' }); });
    await settle(); await answer(rows(0, PAGE));
    const jump = state.jumpToMonth('2026-02');
    await answer(rows(PAGE, 1)); await answer(rows(PAGE - 1, 1)); await jump;
    expect(state.attachments.reachedStart).toBe(anchor === 'bottom');
    expect(state.hasMoreBelow()).toBe(anchor === 'bottom');
    const reset = state.reloadAttachments(); await answer(rows(0, PAGE)); await reset;
  });

  it('discards a stale window after filters reload the first page', async () => {
    const jump = state.jumpToMonth('2026-02');
    const stale = requests.shift()!;
    const reload = state.reloadAttachments();
    await answer(rows(0, PAGE)); await reload;
    stale.resolve(rows(PAGE, PAGE)); await settle();
    await answer(rows(PAGE - 1, 1)); await jump;
    expect(state.jumped()).toBe(false);
    expect(ids().at(-1)).toBe('0');
  });
});
