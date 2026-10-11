// Current failed readings in the host's standard floating window, refreshed with the queue.
import { For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { onAppEvent, onEvent, pluginResource } from '@plugin-sdk/renderer';
import { attachmentUrl, channelById, channelLabel, countText, createAction, ErrorNote, Icon, LinkButton, look, openArchive, proxiedUrl, setLightbox, SettingsButton, shortDateTime, thumbUrl } from '@plugin-sdk/renderer/kit';
import { plugin, STATUS_EVENT } from '../shared';
import type { FailedImage } from '../shared/types';
import { retryFailedImageText } from './state';
import styles from './FailedImages.module.css';

/** Attachments use Discord's media proxy when the archive has no local copy. */
function remoteSource(job: FailedImage): string {
  try {
    const url = new URL(job.url);
    if (url.hostname === 'cdn.discordapp.com') url.hostname = 'media.discordapp.net';
    return url.href;
  } catch {
    return job.url;
  }
}

/** Attachments keep their filename; previews and fetched photos use their URL's final path segment. */
function imageName(job: FailedImage): string {
  if (job.filename) return job.filename;
  try {
    return decodeURIComponent(new URL(job.url).pathname.split('/').pop() || '') || 'Image';
  } catch {
    return 'Image';
  }
}

function FailedImageRow(props: { job: FailedImage }) {
  const job = () => props.job;
  const [unavailable, setUnavailable] = createSignal(false);
  const name = () => imageName(job());
  const local = () => job().sha256 && job().filename ? attachmentUrl(job().sha256!, job().filename!) : null;
  const preview = () => local() ?? thumbUrl(remoteSource(job()));
  createEffect(on(preview, () => setUnavailable(false), { defer: true }));
  const channel = () => {
    const c = channelById(job().channelId);
    return c ? channelLabel(c) : 'Archived message';
  };
  const source = () => job().imageKey.startsWith('attachment:') ? 'Attachment' : job().imageKey.startsWith('embed:') ? 'Link preview' : 'Post photo';
  const openImage = (): void => {
    setLightbox({ src: local() ?? proxiedUrl(remoteSource(job())), alt: name(), caption: name(), originalUrl: job().url });
  };
  return (
    <li class={`${styles.item} ${look.card}`}>
      <button type="button" class={`${styles.preview} ${look.card}`} aria-label={`View ${name()}`} onClick={openImage} disabled={unavailable()}>
        <Show when={!unavailable()} fallback={<><Icon name="image" /><span class={look.text} data-size="xs" data-tone="muted">Preview unavailable</span></>}>
          <img src={preview()} alt={name()} loading="lazy" onError={() => setUnavailable(true)} />
        </Show>
      </button>
      <div class={styles.details}>
        <span class={`${styles.filename} ${look.text}`} data-size="sm" data-weight="semibold" title={name()}>{name()}</span>
        <span class={`${styles.metadata} ${look.text}`} data-size="xs" data-tone="muted">
          <span>{source()} · {channel()}</span><span>· Requested {shortDateTime(job().requestedAt)}</span>
        </span>
        <p class={`${styles.error} ${look.text}`} data-size="sm" data-tone="danger">{job().error || 'Reading the image failed without an error message.'}</p>
        <LinkButton onClick={() => void openArchive(job().channelId, job().messageId)}>Open message</LinkButton>
      </div>
    </li>
  );
}

export function FailedImagesWindow() {
  const failed = pluginResource(plugin, 'failedImages', () => [], null);
  // Queue refreshes retain each image's row, so focus and previews stay put while other images are read.
  const [rows, setRows] = createStore<FailedImage[]>([]);
  createEffect(() => setRows(reconcile(failed() ?? [], { key: 'seq' })));
  const action = createAction();
  onCleanup(onEvent(plugin, STATUS_EVENT, () => void failed.refetch()));
  onCleanup(onAppEvent('privacy-changed', () => {
    // Hide the previous list immediately while the newly scoped result loads.
    failed.mutate(null);
    void failed.refetch();
  }));
  const retry = (): void => void action.run(async () => {
    await retryFailedImageText();
    await failed.refetch();
  });
  return (
    <div class={styles.window}>
      <div class={styles.toolbar}>
        <div class={styles.intro} aria-live="polite">
          <strong class={look.text} data-size="sm" data-weight="semibold">
            {failed.failure ? 'Failed images unavailable' : failed() === null ? 'Loading failed images…' : countText(failed()!.length, 'failed image')}
          </strong>
          <span class={look.text} data-size="xs" data-tone="muted">Images that couldn’t be read, with the reason for each failure.</span>
        </div>
        <div class={styles.actions}>
          <SettingsButton disabled={failed.loading || action.busy()} onClick={() => void failed.refetch()}>Refresh</SettingsButton>
          <SettingsButton tone="danger" disabled={!failed()?.length || action.busy()} onClick={retry}>
            {action.busy() ? 'Retrying…' : 'Retry failed'}
          </SettingsButton>
        </div>
      </div>
      <ErrorNote error={action.error()} />
      <Show when={failed.failure}>
        <div class={styles.empty} role="alert"><ErrorNote error={`Couldn’t load failed images: ${failed.failure}`} /></div>
      </Show>
      <Show when={failed()?.length} fallback={
        <Show when={!failed.failure}>
          <div class={`${styles.empty} ${look.text}`} data-tone="muted" data-size="sm" role="status">
            {failed() === null ? 'Loading…' : 'No failed images to show.'}
          </div>
        </Show>
      }>
        <ul class={styles.list} aria-label="Failed image readings" aria-busy={failed.loading}>
          <For each={rows}>{(job) => <FailedImageRow job={job} />}</For>
        </ul>
      </Show>
    </div>
  );
}
