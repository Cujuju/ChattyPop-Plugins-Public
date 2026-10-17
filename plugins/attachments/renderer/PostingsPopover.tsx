import { For, Show, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { onAppEvent, onCleanup, pluginResource } from '@plugin-sdk/renderer';
import { AuthorName, Icon, PersonFace, formatBytes, listen, look, openArchiveAt, personName, shortDateTime } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import type { AttachmentItem, AttachmentPosting } from '../shared/types';
import { postingsTarget, setPostingsTarget } from './postingsTarget';
import styles from './PostingsPopover.module.css';

const EMPTY_NAME = { color: null, gradient: null, font: null };
const MESSAGE_BOTTOM = 0;

export function PostingsPopover(props: { item: AttachmentItem; anchor: Element; close(): void }) {
  let pop!: HTMLDivElement;
  const postings = pluginResource(plugin, 'postings', () => props.item.sha256 ? [props.item.sha256] : null, [] as AttachmentPosting[]);
  const close = (): void => { props.close(); if (props.anchor instanceof HTMLElement) props.anchor.focus({ preventScroll: true }); };
  onCleanup(onAppEvent('privacy-changed', props.close));
  const place = (): void => {
    const r = props.anchor.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(pop).getPropertyValue('--cp-popover-gap')) || 0;
    const box = pop.getBoundingClientRect();
    const x = Math.max(gap, Math.min(r.left, innerWidth - box.width - gap));
    const y = r.bottom + gap + box.height <= innerHeight ? r.bottom + gap : Math.max(gap, r.top - box.height - gap);
    pop.style.left = `${x}px`; pop.style.top = `${y}px`;
  };
  onMount(() => {
    pop.showPopover(); place(); pop.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(pop);
    onCleanup(() => observer.disconnect());
  });
  listen(window, 'resize', () => place());
  listen(window, 'scroll', (e) => { if (!pop.contains(e.target as Node)) props.close(); }, { capture: true, passive: true });
  return <Portal><div ref={pop} popover="auto" tabindex={-1} role="dialog" aria-label="Other postings"
    class={`cp-popover ${styles.popover} ${look.popover}`}
    onToggle={(e) => { if (e.newState === 'closed') props.close(); }}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
    <div class={`${styles.head} ${look.popoverHead}`}>
      <span class={look.text} data-size="sm" data-weight="medium">
        Posted {postings.loading ? props.item.postings : postings().length} times · {formatBytes(props.item.bytes)} stored once
      </span>
      <button type="button" class={`${styles.close} ${look.iconButton}`} aria-label="Close postings" onClick={close}><Icon name="close" /></button>
    </div>
    <Show when={postings.loading}><p class={styles.note} role="status">Loading…</p></Show>
    <Show when={postings.failure}><p class={styles.note} role="alert">Postings couldn’t be read.</p></Show>
    <Show when={!postings.loading && !postings.failure}>
      <Show when={postings().length} fallback={<p class={styles.note}>No visible postings.</p>}>
        <For each={postings()}>{(posting) => <button type="button" class={`${styles.row} ${look.row}`} onClick={() => {
          void openArchiveAt({ channelId: posting.channelId, messageId: posting.messageId, bottom: MESSAGE_BOTTOM }); close();
        }}>
          <Show when={posting.authorId}><PersonFace userId={posting.authorId!} channelId={posting.channelId} class={styles.face} /></Show>
          <span class={styles.who}>
            <AuthorName author={posting.authorId && personName(posting.authorId, posting.channelId) || { ...EMPTY_NAME, name: posting.authorName || 'Unknown person' }} />
            <span class={`${styles.place} ${look.text}`} data-size="xs" data-tone="muted">#{posting.channelName}{posting.guildName ? ` · ${posting.guildName}` : ''}</span>
          </span>
          <span class={`${styles.date} ${look.text}`} data-size="xs" data-tone="secondary" data-figures="tabular">{shortDateTime(posting.ts)}</span>
        </button>}</For>
      </Show>
    </Show>
  </div></Portal>;
}

/** The panel's one postings popover, for whichever file asked last. */
export function PostingsHost() {
  return <Show when={postingsTarget()} keyed>{(target) =>
    <PostingsPopover item={target.item} anchor={target.anchor} close={() => setPostingsTarget(null)} />}</Show>;
}
