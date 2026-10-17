import { For, Show, createSignal, onCleanup } from 'solid-js';
import { Icon, channelById, confirmDialog, directory, formatBytes, listen, look, onPointerDownOutside, openMenuAt, type MenuGroup } from '@plugin-sdk/renderer/kit';
import { equalFilterSnapshots, filterNameKey, type AttachmentFilterSnapshot, type AttachmentRange, type SavedAttachmentFilter } from '../shared/savedFilters';
import type { AttachmentSort, AttachmentSortKey } from '../shared/types';
import { applySnapshot, people, savedFilters, setSavedFilters, snapshot } from './state';
import styles from './SavedFilters.module.css';

const RANGE_NAME: Record<Exclude<AttachmentRange, 'all'>, string> = { '1d': 'Past day', '7d': 'Past week', '30d': 'Past month', '1y': 'Past year' };
const SORT_NAME: Record<AttachmentSortKey, Record<AttachmentSort['dir'], string>> = {
  date: { desc: 'Newest first', asc: 'Oldest first' }, size: { desc: 'Largest first', asc: 'Smallest first' },
  name: { asc: 'A to Z', desc: 'Z to A' }, kind: { asc: 'By kind', desc: 'By kind, reversed' },
};
const defaultName = (s: AttachmentFilterSnapshot): string => {
  const parts: string[] = s.kinds.map((k) => ({ image: 'Images', video: 'Videos', audio: 'Audio', file: 'Files' })[k]);
  if (s.place) parts.push(s.place.by === 'channel' ? `#${channelById(s.place.id)?.name ?? s.place.id}` : directory().find((g) => g.id === s.place!.id)?.name ?? s.place.id);
  if (s.who) parts.push(people().find((p) => p.id === s.who)?.name || s.who);
  if (s.range !== 'all') parts.push(RANGE_NAME[s.range]);
  if (s.minBytes) parts.push(`At least ${formatBytes(s.minBytes)}`);
  if (s.presence !== 'stored') parts.push(s.presence === 'gone' ? 'Not on this PC' : 'All storage');
  if (s.uncompressed) parts.push('Can compress');
  if (s.name) parts.push(s.name);
  if (s.sort.key !== 'date' || s.sort.dir !== 'desc') parts.push(SORT_NAME[s.sort.key][s.sort.dir]);
  return parts.join(' · ') || 'All stored files';
};

/** Native top-layer popover; structure is local, every look comes from the host vocabulary. */
export function SavedFilters() {
  const [mode, setMode] = createSignal<'save' | 'manage' | null>(null);
  const [draft, setDraft] = createSignal('');
  const [editing, setEditing] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let captured: AttachmentFilterSnapshot;
  let root!: HTMLSpanElement, trigger!: HTMLButtonElement, pop: HTMLDivElement | undefined;
  let alive = true;
  onCleanup(() => { alive = false; });
  const close = (focus = true): void => {
    if (busy()) return;
    setMode(null); setEditing(null);
    if (focus) trigger.focus({ preventScroll: true });
  };
  const place = (): void => {
    if (!pop) return;
    const r = trigger.getBoundingClientRect(), box = pop.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(pop).getPropertyValue('--cp-popover-gap')) || 0;
    pop.style.left = `${Math.max(gap, Math.min(r.left, innerWidth - box.width - gap))}px`;
    pop.style.top = `${Math.max(gap, Math.min(r.bottom + gap, innerHeight - box.height - gap))}px`;
  };
  const focusField = (): void => queueMicrotask(() => { pop?.querySelector<HTMLInputElement>('input')?.focus(); pop?.querySelector<HTMLInputElement>('input')?.select(); });
  const show = (next: 'save' | 'manage'): void => {
    captured = snapshot(); setDraft(defaultName(captured)); setEditing(null); setError(''); setMode(next);
    queueMicrotask(() => {
      if (!alive || !pop) return;
      pop.showPopover(); place();
      if (next === 'save') focusField(); else pop.querySelector<HTMLButtonElement>('button')?.focus();
    });
  };
  onPointerDownOutside(() => root, () => mode() !== null && !busy(), () => close(false));
  listen(window, 'resize', () => { if (mode()) place(); });
  listen(window, 'scroll', (e) => { if (mode() && !pop?.contains(e.target as Node)) place(); }, { capture: true, passive: true });

  const persist = async (entries: SavedAttachmentFilter[]): Promise<boolean> => {
    try { await setSavedFilters(entries); return true; }
    catch { setError('Saved filters couldn’t be stored. Try again.'); return false; }
  };
  const save = async (): Promise<void> => {
    const name = draft().trim();
    if (!name || busy()) return;
    setBusy(true); setError('');
    const id = editing();
    const duplicate = savedFilters().find((s) => s.id !== id && filterNameKey(s.name) === filterNameKey(name));
    try {
      if (duplicate && !await confirmDialog({ title: 'Replace saved filters?', message: `“${duplicate.name}” already exists. Replace it?`, confirmLabel: 'Replace' })) return;
      const original = id ? savedFilters().find((s) => s.id === id) : undefined;
      if (id && !original) { setError('These saved filters were removed.'); return; }
      const entry: SavedAttachmentFilter = { id: original?.id ?? duplicate?.id ?? crypto.randomUUID(), name, filters: original?.filters ?? captured };
      const rest = savedFilters().filter((s) => s.id !== duplicate?.id);
      const next = original ? rest.map((s) => s.id === id ? entry : s) : [...rest, entry];
      if (await persist(next)) {
        setEditing(null);
        if (mode() === 'save') { setMode(null); trigger.focus(); }
        else queueMicrotask(() => { place(); pop?.querySelector<HTMLButtonElement>('button')?.focus(); });
      }
    } finally { setBusy(false); }
  };
  const rename = (entry: SavedAttachmentFilter): void => { setEditing(entry.id); setDraft(entry.name); setError(''); focusField(); };
  const cancelRename = (): void => {
    const id = editing(); setEditing(null);
    queueMicrotask(() => [...(pop?.querySelectorAll<HTMLButtonElement>('[data-filter-id]') ?? [])].find((el) => el.dataset.filterId === id)?.focus());
  };
  const remove = async (id: string): Promise<void> => {
    setBusy(true); setError('');
    try { await persist(savedFilters().filter((s) => s.id !== id)); }
    finally { setBusy(false); queueMicrotask(() => { place(); pop?.querySelector<HTMLButtonElement>('button')?.focus(); }); }
  };
  const menu = (): void => {
    const entries: MenuGroup = { items: savedFilters().map((s) => ({
      label: s.name, icon: 'bookmark', checked: equalFilterSnapshots(s.filters, snapshot()), run: () => applySnapshot(s.filters),
    })) };
    const groups: MenuGroup[] = [...(entries.items.length ? [entries] : []), { heading: entries.items.length ? undefined : 'No saved filters yet',
      items: [{ label: 'Save current filters…', icon: 'plus', run: () => show('save') },
      ...(savedFilters().length ? [{ label: 'Manage…', icon: 'edit' as const, run: () => show('manage') }] : [])] }];
    openMenuAt(trigger, groups);
  };
  const field = () => <input aria-label={mode() === 'save' ? 'Saved filter name' : 'Rename saved filter'} value={draft()} disabled={busy()}
    onInput={(e) => setDraft(e.currentTarget.value)} onKeyDown={(e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void save(); }
      if (e.key === 'Escape' && editing()) { e.preventDefault(); e.stopPropagation(); cancelRename(); }
    }} />;
  const buttons = () => <div class={styles.actions}>
    <button type="button" class={look.button} data-variant="primary" disabled={!draft().trim() || busy()} onClick={() => void save()}>Save</button>
    <button type="button" class={look.button} disabled={busy()} onClick={() => editing() ? cancelRename() : close()}>Cancel</button>
  </div>;
  return <span ref={root} class={styles.root}>
    <button ref={trigger} type="button" class={`${styles.trigger} ${look.filterChip} ${look.text}`} data-size="xs" aria-haspopup="menu"
      aria-expanded={mode() ? true : undefined} onClick={menu}><Icon name="bookmark" />Saved<span class="cp-chevron" aria-hidden="true" /></button>
    <Show when={mode()}>
      <div ref={pop} popover="manual" role="dialog" aria-label={mode() === 'save' ? 'Save current filters' : 'Manage saved filters'}
        class={`${styles.popover} ${look.popover}`} onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }}>
        <div class={`${styles.head} ${look.text}`} data-size="sm" data-weight="semibold">{mode() === 'save' ? 'Save current filters' : 'Manage saved filters'}</div>
        <Show when={mode() === 'save'} fallback={<div class={styles.entries}>
          <Show when={savedFilters().length} fallback={<p class={look.text} data-size="sm" data-tone="muted">No saved filters yet</p>}>
            <For each={savedFilters()}>{(s) => <div class={styles.entry}>
              <Show when={editing() === s.id} fallback={<>
                <button type="button" class={`${styles.name} ${look.row} ${look.text}`} data-size="sm" data-filter-id={s.id} title={`Rename ${s.name}`} disabled={busy()}
                  onClick={() => rename(s)} onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); rename(s); } }}>{s.name}</button>
                <button type="button" class={look.iconButton} aria-label={`Delete ${s.name}`} disabled={busy()} onClick={() => void remove(s.id)}><Icon name="trash" /></button>
              </>}><div class={styles.edit}>{field()}{buttons()}</div></Show>
            </div>}</For>
          </Show>
        </div>}>{field()}{buttons()}</Show>
        <Show when={error()}><p class={look.text} data-size="xs" data-tone="danger" role="alert">{error()}</p></Show>
        <Show when={mode() === 'manage'}><button type="button" class={look.button} disabled={busy()} onClick={() => close()}>Done</button></Show>
      </div>
    </Show>
  </span>;
}
