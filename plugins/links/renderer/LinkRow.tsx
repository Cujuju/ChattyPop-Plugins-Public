import { Show, type JSX } from 'solid-js';
import { MS_PER_DAY, PLATFORM_INFO } from '@plugin-sdk/shared';
import { Embeds, MessageRow, clockTime, isMediaOnly, look, openArchive, shortDate } from '@plugin-sdk/renderer/kit';
import { LINK_WORTH_LEVELS, type LinkItem } from '../shared/types';
import styles from './Links.module.css';

/** Link embeds carry no user mentions to resolve. */
const NO_MENTIONS: Record<string, string> = {};

/** Time of day for today's links, else a short date. */
const when = (ts: number): string => (Date.now() - ts < MS_PER_DAY ? clockTime(ts) : shortDate(ts));

/** Display text when Discord didn't unfurl a title: host plus path. */
const bareUrl = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '');

/**
 * One shared link, drawn as the Archive draws the message that shared it: avatar with the platform badge under it,
 * name and time, then the message. The name line adds where it was shared (opens it in the Archive), and the date when the
 * list has no day headings (`dated`).
 */
export function LinkRow(props: { item: LinkItem; dated?: boolean }) {
  const it = () => props.item;
  /** The message draws its own embeds; the link's card is added only when it came from elsewhere (a later share, FxTwitter). */
  const extraCard = () => {
    const e = it().embed;
    return e && !it().message?.embeds.some((m) => m.url === e.url) ? e : null;
  };
  const badge = () => (
    <span
      class={`${styles.badge} ${look.platformBadge} ${look.text}`}
      data-size="2xs"
      data-weight="semibold"
      data-tracking="label-sm"
      data-line="none"
      title={PLATFORM_INFO[it().platform].label}
    >
      {PLATFORM_INFO[it().platform].badge}
    </span>
  );
  const judgment = () => (
    <Show when={it().category || it().flagged || it().worth !== null}>
      <span
        class={look.text}
        data-size="2xs"
        data-line="meta"
        data-case="upper"
        data-tracking="label-sm"
        data-tone={it().flagged ? 'danger' : 'muted'}
        data-flagged={it().flagged}
        title="Jev's estimate from the link and its preview (a model's guess, not a fact)"
      >
        {[it().flagged ? 'flagged: spam, scam or NSFW' : null, it().category, it().worth !== null ? `worth: ${LINK_WORTH_LEVELS[Math.round(it().worth!)]}` : null]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </Show>
  );
  const card = () => <Show when={extraCard()}>{(e) => <Embeds embeds={[e()]} mentions={NO_MENTIONS} />}</Show>;
  const open = () => void openArchive(it().channelId, it().messageId);
  return (
    <div class={styles.share} data-platform={it().platform}>
      <Show when={it().message} fallback={<Unarchived item={it()} badge={badge()} judgment={judgment()} card={card()} open={open} />}>
        {(m) => (
          <MessageRow
            message={m()}
            density="cozy"
            grouped={false}
            focused={false}
            gutter={badge()}
            headExtra={
              <button
                type="button"
                class={`${styles.origin} ${look.quietLink} ${look.text}`}
                data-size="2xs"
                data-font="sans"
                onClick={open}
                title="Show the message in the Archive"
              >
                <Show when={props.dated}>{shortDate(it().ts)} · </Show>#{it().channelName}
                {' · '}{it().guildName}
                <Show when={it().shares > 1}> · shared {it().shares}×</Show>
              </button>
            }
          >
            {card()}
            {judgment()}
          </MessageRow>
        )}
      </Show>
    </div>
  );
}

/** The sharing message is no longer in the archive: badge, who/where/when, the link and its card. */
function Unarchived(props: { item: LinkItem; badge: JSX.Element; judgment: JSX.Element; card: JSX.Element; open: () => void }) {
  const it = () => props.item;
  const cardHasTitle = (): boolean => {
    const e = it().embed;
    return Boolean(e && (e.title || e.author) && !isMediaOnly(e));
  };
  return (
    <article class={`${styles.row} ${look.row}`}>
      {props.badge}
      <div class={styles.main}>
        <button
          type="button"
          class={`${styles.meta} ${look.quietLink} ${look.text}`}
          data-size="xs"
          data-line="meta"
          onClick={() => props.open()}
          title="Show the message in the Archive"
        >
          <span class={look.text} data-weight="semibold" data-tone="secondary">{it().authorName}</span> · #{it().channelName} · {when(it().ts)}
          <Show when={it().shares > 1}> · shared {it().shares}×</Show>
        </button>
        {props.judgment}
        <Show when={!cardHasTitle()}>
          <a
            class={`${styles.linkTitle} ${look.link} ${look.text}`}
            data-size="md"
            data-weight="semibold"
            data-line="tight"
            href={it().url}
            target="_blank"
            rel="noreferrer"
            title={it().url}
          >
            {it().title ?? bareUrl(it().url)}
          </a>
        </Show>
        {props.card}
      </div>
    </article>
  );
}
