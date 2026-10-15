import { Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { Icon, attachmentPosterUrl, attachmentThumbUrl, attachmentUrl, look, type IconName } from '@plugin-sdk/renderer/kit';
import type { AttachmentItem, AttachmentKind } from '../shared/types';
import { storedRef } from './actions';
import styles from './Attachments.module.css';

export const KIND_ICON: Record<AttachmentKind, IconName> = { image: 'image', video: 'play', audio: 'waveform', file: 'text' };
const THUMB = 0;
const ORIGINAL = 1;
const PLACEHOLDER = 2;

/** Thumbnails fall back once to a stored image or video poster, then to a file placeholder. Spoilers show no picture. */
export function AttachmentPicture(props: { item: AttachmentItem; list?: boolean }) {
  const [attempt, setAttempt] = createSignal(THUMB);
  const [loaded, setLoaded] = createSignal(false);
  // A memo, so a reread's new item object for the same file keeps the loaded picture: its img fires no second load.
  const file = createMemo(() => `${props.item.id}:${props.item.sha256}:${props.item.storedExt}`);
  createEffect(on(file, () => { setAttempt(THUMB); setLoaded(false); }, { defer: true }));
  const picture = (): boolean => !props.item.spoiler && props.item.status === 'stored' && !!props.item.sha256
    && (props.item.kind === 'image' || props.item.kind === 'video') && attempt() < PLACEHOLDER;
  const src = (): string => {
    const ref = storedRef(props.item);
    if (!ref) return '';
    return attempt() === THUMB ? attachmentThumbUrl(ref) : props.item.kind === 'image' ? attachmentUrl(ref) : attachmentPosterUrl(props.item.id);
  };
  return (
    <Show when={picture()} fallback={
      <span class={styles.placeholder}>
        <Icon class={styles.placeholderIcon} name={props.item.spoiler ? 'eyeOff' : KIND_ICON[props.item.kind]} />
        <Show when={!props.list}><span class={`${styles.placeholderName} ${look.text}`} data-size="2xs">{props.item.filename}</span></Show>
      </span>
    }>
      <img class={`${props.list ? styles.listThumbImg : styles.thumb} ${look.mediaThumb}`} src={src()} alt="" loading="lazy" decoding="async"
        data-loaded={loaded() ? true : undefined} onLoad={() => setLoaded(true)}
        onError={() => { setLoaded(false); setAttempt((n) => n + 1); }} />
    </Show>
  );
}
