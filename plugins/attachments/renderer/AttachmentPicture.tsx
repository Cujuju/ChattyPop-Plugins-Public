import { Show, createEffect, createMemo, createSignal, on, onMount } from 'solid-js';
import { batchWrites, onCleanup } from '@plugin-sdk/renderer';
import { Icon, attachmentPosterUrl, attachmentThumbUrl, attachmentUrl, look, loopWhileLooking, type IconName } from '@plugin-sdk/renderer/kit';
import type { AttachmentItem, AttachmentKind } from '../shared/types';
import { storedRef } from './actions';
import { hoverZoom } from './state';
import type { TileZoom } from './zoom';
import styles from './Attachments.module.css';
import { canHoverPlay, hoverPlayer } from './hoverVideo';

export const KIND_ICON: Record<AttachmentKind, IconName> = { image: 'image', video: 'play', audio: 'waveform', file: 'text' };
const THUMB = 0;
const ORIGINAL = 1;
const PLACEHOLDER = 2;

/** Whether `img`, drawn whole in its box and grown by `scale`, would show more pixels than it holds. */
const outgrows = (img: HTMLImageElement, scale: number): boolean =>
  img.naturalWidth > 0 && Math.min(img.clientWidth / img.naturalWidth, img.clientHeight / img.naturalHeight) * scale * devicePixelRatio > 1;

/**
 * Thumbnails fall back once to a stored image or video poster, then to a file placeholder. Spoilers show no picture.
 * `zoom`: the hovered tile's; a thumbnail it would outgrow gives way to the full picture.
 */
export function AttachmentPicture(props: { item: AttachmentItem; list?: boolean; zoom?: TileZoom | null; hovered?: boolean }) {
  const [attempt, setAttempt] = createSignal(THUMB);
  const [loaded, setLoaded] = createSignal(false);
  /** Showing the full picture in the thumbnail's place; kept once loaded, so a second hover is instant. */
  const [sharp, setSharp] = createSignal(false);
  const token = Symbol('hover-video');
  const [reduced, setReduced] = createSignal(true);
  const [playing, setPlaying] = createSignal(false);
  const [videoFailed, setVideoFailed] = createSignal(false);
  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const read = (): void => { setReduced(media.matches); };
    read();
    media.addEventListener('change', read);
    onCleanup(() => media.removeEventListener('change', read));
  });
  createEffect(() => {
    file();
    if (canHoverPlay(props.item, { hovered: props.hovered === true, list: props.list === true, reducedMotion: reduced() })
      && attempt() < PLACEHOLDER && !videoFailed()) hoverPlayer.enter(token);
    else hoverPlayer.leave(token);
    onCleanup(() => hoverPlayer.leave(token));
  });
  createEffect(() => { if (hoverPlayer.active() !== token) setPlaying(false); });
  onCleanup(() => hoverPlayer.leave(token));
  let img: HTMLImageElement | undefined;
  // Read again once the thumbnail loads: a hover that began before it had no size to measure.
  createEffect(() => {
    const z = props.zoom;
    if (z && img && loaded() && attempt() === THUMB && outgrows(img, z.scale)) setSharp(true);
  });
  // A memo, so a reread's new item object for the same file keeps the loaded picture: its img fires no second load.
  const file = createMemo(() => `${props.item.id}:${props.item.sha256}:${props.item.storedExt}`);
  createEffect(on(file, () => batchWrites(() => { setAttempt(THUMB); setLoaded(false); setSharp(false); setVideoFailed(false); }), { defer: true }));
  const picture = (): boolean => !props.item.spoiler && props.item.status === 'stored' && !!props.item.sha256
    && (props.item.kind === 'image' || props.item.kind === 'video') && attempt() < PLACEHOLDER;
  const src = (full: boolean): string => {
    const ref = storedRef(props.item);
    if (!ref) return '';
    return !full ? attachmentThumbUrl(ref) : props.item.kind === 'image' ? attachmentUrl(ref) : attachmentPosterUrl(props.item.id);
  };
  // A thumbnail that loaded stays on show if the full picture fails: only a failed thumbnail falls back.
  const failed = (): void => {
    if (sharp()) setSharp(false);
    else batchWrites(() => { setLoaded(false); setAttempt((n) => n + 1); });
  };
  return (
    <Show when={picture()} fallback={
      <span class={styles.placeholder}>
        <Icon class={styles.placeholderIcon} name={props.item.spoiler ? 'eyeOff' : KIND_ICON[props.item.kind]} />
        <Show when={!props.list}><span class={`${styles.placeholderName} ${look.text}`} data-size="2xs">{props.item.filename}</span></Show>
      </span>
    }>
      {/* A grid tile's square: the picture's blurred copy fills it behind the whole picture. */}
      <Show when={!props.list && loaded()}>
        <span class={styles.backdrop} aria-hidden="true"><img class={`${styles.backdropImg} ${look.mediaBackdrop}`} src={src(attempt() !== THUMB)} alt="" /></span>
      </Show>
      <img ref={img} class={`${props.list ? styles.listThumbImg : styles.thumb} ${look.mediaThumb}`} src={src(attempt() !== THUMB || sharp())} alt=""
        loading="lazy" decoding="async" data-loaded={loaded() ? true : undefined} data-zoom={props.list || hoverZoom() === 1 ? undefined : true}
        style={{ '--zoom': props.zoom?.scale ?? hoverZoom(), '--zoom-origin': props.zoom?.origin }} onLoad={() => setLoaded(true)} onError={failed} />
      <Show when={hoverPlayer.active() === token}>
        <video ref={(video) => { loopWhileLooking(video); onCleanup(() => { video.pause(); video.removeAttribute('src'); video.load(); }); }}
          class={`${styles.thumb} ${styles.hoverVideo} ${look.mediaThumb}`} src={attachmentUrl(storedRef(props.item)!)} muted loop playsinline
          aria-hidden="true" data-loaded={playing() ? true : undefined} data-zoom={hoverZoom() === 1 ? undefined : true}
          style={{ '--zoom': props.zoom?.scale ?? hoverZoom(), '--zoom-origin': props.zoom?.origin }}
          onPlaying={() => { if (hoverPlayer.active() === token) setPlaying(true); }} onError={() => setVideoFailed(true)} />
      </Show>
    </Show>
  );
}
