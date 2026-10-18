import { For, Show, type JSX } from 'solid-js';
import { DM_GUILD_ID } from '@plugin-sdk/shared';
import type { DirectoryGuild } from '@plugin-sdk/shared';
import { DmFace, FoldChevron, GuildIcon, Icon, ThreadSpine, ThreadsBadge, channelById, channelSigil, directory, foldGesture, isDmChannel, isThread, look, threadsShown, unseenInThreads } from '@plugin-sdk/renderer/kit';
import { filesCount } from './actions';
import { channelsHidden, places, setChannelsHidden, setWhere, where } from './state';
import styles from './PlaceRail.module.css';

/** The server the place is in: the picked one, or the picked channel's. */
const placeGuild = (): string | null => {
  const w = where();
  if (!w) return null;
  return w.by === 'guild' ? w.id : channelById(w.id)?.guildId ?? null;
};
type DirectoryChannel = DirectoryGuild['channels'][number];

const pickedChannel = (): string | null => {
  const w = where();
  return w?.by === 'channel' ? w.id : null;
};

/** `expanded`: whether its channel column shows, for a server or DMs (absent for All servers, which has none). */
function ServerButton(props: { label: string; current: boolean; expanded?: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <button type="button" class={`${styles.server} ${look.navItem}`} aria-current={props.current ? 'page' : undefined} aria-expanded={props.expanded}
      aria-label={props.label} title={props.label} onClick={() => props.onClick()}>{props.children}</button>
  );
}

/** Whether `guildId`'s channel column shows; undefined for a server not picked, which has none. */
const columnShown = (guildId: string): boolean | undefined => (placeGuild() === guildId ? !channelsHidden() : undefined);

/** Picks a server (or DMs) and shows its channels; the picked one again folds or unfolds them, keeping the place. */
const pickServer = (guildId: string): void => {
  if (placeGuild() === guildId) { void setChannelsHidden(!channelsHidden()); return; }
  setWhere({ by: 'guild', id: guildId });
  void setChannelsHidden(false);
};

/**
 * A place to pick. `lead`: before the name (a fold slot, a thread's spine, a DM's face); `trail`: before the count.
 * `fold`: a channel's fold gestures (foldGesture), tried before a click picks it.
 */
function PlaceButton(props: { label: string; count: number; current: boolean; onClick: () => void; thread?: boolean; expanded?: boolean;
  fold?: (e: MouseEvent | KeyboardEvent) => boolean; lead?: JSX.Element; trail?: JSX.Element }) {
  const fold = (e: MouseEvent | KeyboardEvent): boolean => props.fold?.(e) ?? false;
  return (
    <button type="button" class={`${styles.place} ${look.navItem}`} data-thread={props.thread ? '' : undefined}
      aria-current={props.current ? 'page' : undefined} aria-expanded={props.expanded}
      onClick={(e) => { if (!fold(e)) props.onClick(); }} onDblClick={fold} onKeyDown={fold}>
      {props.lead}
      <span class={`${styles.placeName} ${look.text}`} data-size={props.thread ? 'xs' : 'sm'} data-tone={props.thread ? 'secondary' : undefined}>{props.label}</span>
      {props.trail}
      <span class={look.text} data-size="2xs" data-tone="muted" data-figures="tabular">{props.count}</span>
    </button>
  );
}

/** A channel, then its threads holding matching files; folded (shared with the Archive), only a picked thread shows. */
function ChannelPlace(props: { channel: DirectoryChannel; threads: DirectoryChannel[]; slot: boolean }) {
  const c = () => props.channel;
  const dm = () => { const channel = c(); return isDmChannel(channel) ? channel : null; };
  const foldable = (): boolean => props.threads.length > 0;
  const shown = (): boolean => threadsShown(c().id);
  const expanded = (): boolean | undefined => (foldable() ? shown() : undefined);
  const unseen = (): number => (foldable() && !shown() ? unseenInThreads(c().id).newCount : 0);
  return (
    <>
      <PlaceButton label={dm() ? c().name : `${channelSigil(c())}${c().name}`} count={places().channels[c().id] ?? 0}
        current={pickedChannel() === c().id} onClick={() => setWhere({ by: 'channel', id: c().id })}
        expanded={expanded()} fold={(e) => foldable() && foldGesture(e, c().id)}
        lead={<>
          <Show when={props.slot}><FoldChevron foldable={foldable()} open={shown()} /></Show>
          {/* A DM reads as the DM list shows it: its face and name, no sigil. */}
          <Show when={dm()}>{(face) => <DmFace channel={face()} />}</Show>
        </>}
        trail={<Show when={unseen() > 0}><ThreadsBadge count={unseen()} /></Show>} />
      <For each={props.threads.filter((t) => shown() || t.id === pickedChannel())}>{(t) => (
        <PlaceButton label={t.name} count={places().threads[t.id] ?? 0} thread lead={<ThreadSpine />}
          current={pickedChannel() === t.id} onClick={() => setWhere({ by: 'channel', id: t.id })} />
      )}</For>
    </>
  );
}

/** Discord's two left columns: servers holding matching files, then the picked server's channels. */
export function PlaceRail() {
  const servers = () => directory().filter((g) => places().guilds[g.id] || g.id === placeGuild());
  const guild = () => directory().find((g) => g.id === placeGuild());
  /** The picked server's channel column, unless folded away. */
  const column = () => (channelsHidden() ? undefined : guild());
  const channels = () => guild()?.channels.filter((c) => !isThread(c) && (places().channels[c.id] || c.id === pickedChannel())) ?? [];
  /** A channel's threads holding matching files, most recently active first, as the Archive lists them. */
  const threadsOf = (channelId: string): DirectoryChannel[] => (guild()?.channels ?? [])
    .filter((t) => isThread(t) && t.parentId === channelId && places().threads[t.id])
    .sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0));
  /** DMs have no threads: their list keeps no fold slot. */
  const slot = (): boolean => placeGuild() !== DM_GUILD_ID;
  const total = () => Object.values(places().guilds).reduce((sum, n) => sum + n, 0);
  return (
    <>
      {/* The last column before the pane carries its rule: the channels when a server is picked, else the servers. */}
      <nav class={`${styles.servers} ${look.chrome} ${column() ? '' : look.ruleEnd}`} aria-label="Servers">
        <ServerButton label={`All servers · ${filesCount(total())}`} current={!where()} onClick={() => setWhere(null)}><Icon name="archive" class={styles.glyph} /></ServerButton>
        <For each={servers()}>{(g) => (
          <ServerButton label={`${g.name} · ${filesCount(places().guilds[g.id] ?? 0)}`} current={placeGuild() === g.id}
            expanded={columnShown(g.id)} onClick={() => pickServer(g.id)}>
            <Show when={g.id !== DM_GUILD_ID} fallback={<Icon name="conversation" class={styles.glyph} />}><GuildIcon id={g.id} name={g.name} icon={g.icon} /></Show>
          </ServerButton>
        )}</For>
      </nav>
      <Show when={column()}>{(g) => (
        <nav class={`${styles.channels} ${look.ruleEnd}`} aria-label={`Channels in ${g().name}`}>
          <div class={styles.headingRow}>
            <h3 class={`${styles.heading} ${look.text}`} data-size="xs" data-weight="semibold" data-tone="secondary">{g().name}</h3>
            <button type="button" class={`${styles.fold} ${look.iconButton}`} aria-label="Hide channels" title="Hide channels (click the server again to show them)"
              onClick={() => void setChannelsHidden(true)}><Icon name="chevronsLeft" /></button>
          </div>
          <PlaceButton label={g().id === DM_GUILD_ID ? 'All conversations' : 'All channels'} count={places().guilds[g().id] ?? 0} current={where()?.by === 'guild'}
            onClick={() => setWhere({ by: 'guild', id: g().id })} lead={<Show when={slot()}><FoldChevron foldable={false} open={false} /></Show>} />
          <For each={channels()}>{(c) => <ChannelPlace channel={c} threads={threadsOf(c.id)} slot={slot()} />}</For>
        </nav>
      )}</Show>
    </>
  );
}
