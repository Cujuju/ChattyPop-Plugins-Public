// Tags panel: the owner's tags and their Jev range tools.
import { For, Show, createEffect, createResource, createSignal, on } from 'solid-js';
import { TAG_RANGE_MAX, type TagRangeRequest, type TagRangeResult } from '../shared/types';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import {
  archivedChannels,
  channelLabel,
  projectedJevUsd,
  createAction,
  errorText,
  localRange,
  toLocalInput,
  usdText,
  look,
  Select,
} from '@plugin-sdk/renderer/kit';
import { customTags, editingTag, runTagRange, tagRangeChannel, tagRangeCount, tags } from './state';
import styles from './Tags.module.css';

/** Default message count for range runs. */
const DEFAULT_LATEST = 200;

const SCOPES = [
  {
    value: 'latest',
    label: 'Latest messages',
  },
  {
    value: 'between',
    label: 'Between two times',
  },
];

/** Runs chosen tags' Jev questions over a channel's latest N messages or a timeframe, with a cost estimate first. */
export function TagRange() {
  // Jev sends text to a hosted model, so local-AI-only channels are left out.
  const channels = () => archivedChannels({ hostedAi: true }).map((c) => ({
    value: c.id,
    label: channelLabel(c, c.guildName),
  }));
  const [channelId, setChannelId] = createSignal<string>(tagRangeChannel() ?? '');
  const [kind, setKind] = createSignal<'latest' | 'between'>('latest');
  const [count, setCount] = createSignal(DEFAULT_LATEST);
  const [from, setFrom] = createSignal(toLocalInput(Date.now() - MS_PER_DAY));
  const [to, setTo] = createSignal(toLocalInput(Date.now()));
  const initial = editingTag();
  const [picked, setPicked] = createSignal<number[]>(typeof initial === 'number' ? [initial] : []);
  const [result, setResult] = createSignal<TagRangeResult | null>(null);
  const action = createAction();
  const { busy, error } = action;
  createEffect(on(tagRangeChannel, (id) => id && setChannelId(id), { defer: true }));
  createEffect(() => {
    if (!channelId() && channels().length) setChannelId(channels()[0]!.value);
  });
  const askable = () => tags().filter((t) => t.jevQuestion);
  const chosen = () => picked().filter((id) => askable().some((t) => t.id === id));
  const request = (): TagRangeRequest | null => {
    if (!channelId()) return null;
    if (kind() === 'latest') return {
      channelId: channelId(),
      tagIds: chosen(),
      scope: {
        kind: 'latest',
        count: count(),
      },
    };
    const range = localRange(from(), to());
    return range ? {
      channelId: channelId(),
      tagIds: chosen(),
      scope: {
        kind: 'between',
        ...range,
      },
    } : null;
  };
  const [messages] = createResource(request, tagRangeCount);
  /** The count, undefined while unknown or failed (reading a failed resource throws). */
  const counted = (): number | undefined => (messages.error ? undefined : messages());
  const estimate = () => projectedJevUsd((counted() ?? 0) * chosen().length);
  const run = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    const r = request();
    if (!r) return;
    setResult(null);
    const done = await action.run(() => runTagRange(r));
    if (done) setResult(done);
  };
  return (
    <form class={`${styles.card} ${look.card}`} onSubmit={(e) => void run(e)}>
      <h3 class={look.text} data-size="sm" data-weight="semibold" data-tone="primary" data-font="sans">Tag a range with Jev</h3>
      <label class="cp-field">
        <span class="cp-label">Channel (with its threads)</span>
        <Select class={styles.input} value={channelId()} options={channels()} onChange={setChannelId} />
      </label>
      <label class="cp-field">
        <span class="cp-label">Messages</span>
        <Select class={styles.input} value={kind()} options={SCOPES} onChange={(v) => setKind(v === 'between' ? 'between' : 'latest')} />
      </label>
      <Show
        when={kind() === 'latest'}
        fallback={
          <div class={styles.inline}>
            <input class={`${styles.input} ${look.text}`} data-size="sm" data-font="sans" type="datetime-local" aria-label="From" value={from()} onInput={(e) => setFrom(e.currentTarget.value)} />
            <span class="cp-hint">to</span>
            <input class={`${styles.input} ${look.text}`} data-size="sm" data-font="sans" type="datetime-local" aria-label="To" value={to()} onInput={(e) => setTo(e.currentTarget.value)} />
          </div>
        }
      >
        <input
          class={`${styles.input} ${look.text}`}
          data-size="sm"
          data-font="sans"
          type="number"
          min={1}
          max={TAG_RANGE_MAX}
          aria-label="How many of the latest messages"
          value={count()}
          onInput={(e) => setCount(Math.min(TAG_RANGE_MAX, Math.max(1, Number(e.currentTarget.value) || 1)))}
        />
      </Show>
      <fieldset class="cp-field">
        <legend class="cp-label">Tags to apply</legend>
        <For each={askable()}>
          {(t) => (
            <label class="cp-check">
              <input type="checkbox" checked={picked().includes(t.id)} onChange={(e) => setPicked(e.currentTarget.checked ? [...picked(), t.id] : picked().filter((x) => x !== t.id))} />
              {t.name}
            </label>
          )}
        </For>
      </fieldset>
      <p class="cp-hint">
        {messages.loading ? 'Counting…' : messages.error ? errorText(messages.error) : `${counted() ?? 0} messages × ${chosen().length} tags ≈ ${usdText(estimate())}`} (at most {TAG_RANGE_MAX} messages
        per run). Jev reads each message with the two before it; tags you added or removed by hand stay as they are.
      </p>
      <Show when={!customTags.on()}>
        <p class="cp-hint">Turn on Settings → Jev → Your own tags to run this.</p>
      </Show>
      <Show when={error()}>
        <p class="cp-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={result()}>
        {(r) => (
          <p class="cp-hint" role="status">
            Asked about {r().asked} messages: {r().applied} newly tagged{r().failed ? `, ${r().failed} failed` : ''}
            {r().costUsd !== null ? ` · ${usdText(r().costUsd!)}` : ''}.
          </p>
        )}
      </Show>
      <div class="cp-actions">
        <button type="submit" class="cp-button" disabled={busy() || !chosen().length || !counted() || !customTags.on()}>
          {busy() ? 'Tagging…' : 'Run'}
        </button>
      </div>
    </form>
  );
}
