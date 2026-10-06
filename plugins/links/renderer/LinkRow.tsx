import { Show } from 'solid-js';
import { MS_PER_DAY, PLATFORM_INFO } from '@plugin-sdk/shared';
import { Embeds, MessageRow, clockTime, isMediaOnly, look, openArchive, shortDate } from '@plugin-sdk/renderer/kit';
import { LINK_WORTH_LEVELS, type LinkCard, type LinkItem } from '../shared/types';
import styles from './Links.module.css';

/** Link embeds carry no user mentions to resolve. */
const NO_MENTIONS: Record<string, string> = {};

/** Time of day for today's links, else a short date. */
const when = (ts: number): string => (Date.now() - ts < MS_PER_DAY ? clockTime(ts) : shortDate(ts));

/** Display text when Discord didn't unfurl a title: host plus path. */
const bareUrl = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '');

/** The link's platform, as the badge under the sharer's avatar. */
function PlatformBadge(props: { item: LinkCard }) {
  return (
    <span
      class={`${styles.badge} ${look.platformBadge} ${look.text}`}
      data-size="2xs"
      data-weight="semibold"
      data-tracking="label-sm"
      data-line="none"
      title={PLATFORM_INFO[props.item.platform].label}
    >
      {PLATFORM_INFO[props.item.platform].badge}
    </span>
  );
}

/** Jev's reading of the link, when it has one. */
function Judgment(props: { item: LinkCard }) {
  const it = () => props.item;
  return (
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
}

/** Draws shared links with Archive message rows, a platform badge, and an origin link. dated adds dates when day headings are absent. */
export function LinkRow(props: { item: LinkItem; dated?: boolean }) {
  const it = () => props.item;
  /** The message draws its own embeds; the link's card is added only when it came from elsewhere (a later share, FxTwitter). */
  const extraCard = () => {
    const e = it().embed;
    return e && !it().message?.embeds.some((m) => m.url === e.url) ? e : null;
  };
  return (
    <div class={styles.share} data-platform={it().platform}>
      {/* The sharing message is no longer in the archive: the link's card stands alone. */}
      <Show when={it().message} fallback={<LinkCardRow item={it()} />}>
        {(m) => (
          <MessageRow
            message={m()}
            density="cozy"
            grouped={false}
            focused={false}
            gutter={<PlatformBadge item={it()} />}
            headExtra={
              <button
                type="button"
                class={`${styles.origin} ${look.quietLink} ${look.text}`}
                data-size="2xs"
                data-font="sans"
                onClick={() => void openArchive(it().channelId, it().messageId)}
                title="Show the message in the Archive"
              >
                <Show when={props.dated}>{shortDate(it().ts)} · </Show>#{it().channelName}
                {' · '}{it().guildName}
                <Show when={it().shares > 1}> · shared {it().shares}×</Show>
              </button>
            }
          >
            <Show when={extraCard()}>{(e) => <Embeds embeds={[e()]} mentions={NO_MENTIONS} />}</Show>
            <Judgment item={it()} />
          </MessageRow>
        )}
      </Show>
    </div>
  );
}

/** Fallback link row shows origin metadata, URL, and card. own omits the person's name, includes the server, and clamps card descriptions. */
export function LinkCardRow(props: { item: LinkCard; own?: boolean }) {
  const it = () => props.item;
  const cardHasTitle = (): boolean => {
    const e = it().embed;
    return Boolean(e && (e.title || e.author) && !isMediaOnly(e));
  };
  return (
    <article class={`${styles.row} ${look.row}`}>
      <PlatformBadge item={it()} />
      <div class={styles.main}>
        <button
          type="button"
          class={`${styles.meta} ${look.quietLink} ${look.text}`}
          data-size="xs"
          data-line="meta"
          onClick={() => void openArchive(it().channelId, it().messageId)}
          title="Show the message in the Archive"
        >
          <Show when={!props.own}>
            <span class={look.text} data-weight="semibold" data-tone="secondary">{it().authorName}</span> ·{' '}
          </Show>
          #{it().channelName}
          <Show when={props.own && it().guildName}> · {it().guildName}</Show> · {when(it().ts)}
          <Show when={it().shares > 1}> · shared {it().shares}×</Show>
        </button>
        <Judgment item={it()} />
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
        <Show when={it().embed}>{(e) => <Embeds embeds={[e()]} mentions={NO_MENTIONS} brief={props.own} />}</Show>
      </div>
    </article>
  );
}
