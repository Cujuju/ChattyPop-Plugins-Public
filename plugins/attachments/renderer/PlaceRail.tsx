import { For, Show, type JSX } from 'solid-js';
import { DM_GUILD_ID } from '@plugin-sdk/shared';
import { GuildIcon, Icon, channelById, channelSigil, directory, isThread, look } from '@plugin-sdk/renderer/kit';
import { places, setWhere, where } from './state';
import styles from './PlaceRail.module.css';

/** The server the place is in: the picked one, or the picked channel's. */
const placeGuild = (): string | null => {
  const w = where();
  if (!w) return null;
  return w.by === 'guild' ? w.id : channelById(w.id)?.guildId ?? null;
};
const pickedChannel = (): string | null => {
  const w = where();
  return w?.by === 'channel' ? w.id : null;
};
const files = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'}`;

function ServerButton(props: { label: string; active: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <button type="button" class={`${styles.server} ${look.railButton}`} data-active={props.active} aria-pressed={props.active}
      aria-label={props.label} title={props.label} onClick={() => props.onClick()}>{props.children}</button>
  );
}

/** `count`: undefined for a picked thread, whose files the rail counts in its channel's. */
function PlaceButton(props: { label: string; count: number | undefined; current: boolean; onClick: () => void }) {
  return (
    <button type="button" class={`${styles.place} ${look.navItem}`} aria-current={props.current ? 'page' : undefined} onClick={() => props.onClick()}>
      <span class={`${styles.placeName} ${look.text}`} data-size="sm">{props.label}</span>
      <Show when={props.count !== undefined}>
        <span class={look.text} data-size="2xs" data-tone="muted" data-figures="tabular">{props.count}</span>
      </Show>
    </button>
  );
}

/** Discord's two left columns: servers holding matching files, then the picked server's channels. */
export function PlaceRail() {
  const servers = () => directory().filter((g) => places().guilds[g.id] || g.id === placeGuild());
  const guild = () => directory().find((g) => g.id === placeGuild());
  const channels = () => guild()?.channels.filter((c) => (!isThread(c) && places().channels[c.id]) || c.id === pickedChannel()) ?? [];
  const total = () => Object.values(places().guilds).reduce((sum, n) => sum + n, 0);
  return (
    <>
      {/* The last column before the pane carries its rule: the channels when a server is picked, else the servers. */}
      <nav class={`${styles.servers} ${look.chrome} ${guild() ? '' : look.ruleEnd}`} aria-label="Servers">
        <ServerButton label={`All servers · ${files(total())}`} active={!where()} onClick={() => setWhere(null)}><Icon name="apps" /></ServerButton>
        <For each={servers()}>{(g) => (
          <ServerButton label={`${g.name} · ${files(places().guilds[g.id] ?? 0)}`} active={placeGuild() === g.id} onClick={() => setWhere({ by: 'guild', id: g.id })}>
            <Show when={g.id !== DM_GUILD_ID} fallback={<Icon name="conversation" />}><GuildIcon id={g.id} name={g.name} icon={g.icon} /></Show>
          </ServerButton>
        )}</For>
      </nav>
      <Show when={guild()}>{(g) => (
        <nav class={`${styles.channels} ${look.ruleEnd}`} aria-label={`Channels in ${g().name}`}>
          <h3 class={`${styles.heading} ${look.text}`} data-size="xs" data-weight="semibold" data-tone="secondary">{g().name}</h3>
          <PlaceButton label="All channels" count={places().guilds[g().id] ?? 0} current={where()?.by === 'guild'} onClick={() => setWhere({ by: 'guild', id: g().id })} />
          <For each={channels()}>{(c) => (
            <PlaceButton label={`${channelSigil(c)}${c.name}`} count={isThread(c) ? undefined : places().channels[c.id] ?? 0}
              current={pickedChannel() === c.id} onClick={() => setWhere({ by: 'channel', id: c.id })} />
          )}</For>
        </nav>
      )}</Show>
    </>
  );
}
