import { Avatar, PersonName, look } from '@plugin-sdk/renderer/kit';
import type { StatsPoster } from '../shared/types';
import type { JSX } from 'solid-js';
import { SHARE_ROW, formatCount, share } from './section';
import styles from './Stats.module.css';

/** Shared identity markup keeps names and avatars on the kit's live identity path. */
export function PosterIdentity(props: { poster: StatsPoster; channelId: string | null; rank?: number }) {
  return <span class={styles.posterIdentity}>
    {props.rank !== undefined && <span class={styles.rowCount}>{formatCount(props.rank)}.</span>}
    <Avatar author={{
      id: props.poster.userId, name: props.poster.name, username: null, avatar: props.poster.avatar,
      color: null, gradient: null, font: null, decoration: null, roleIcon: null, tag: null, app: null,
    }} />
    <PersonName userId={props.poster.userId} channelId={props.channelId} fallback={props.poster.name} class={styles.rowName} />
  </span>;
}

export function PosterRow(props: { poster: StatsPoster; channelId: string | null; rank: number; max: number; value?: JSX.Element; title?: string }) {
  return (
    <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(props.poster.count, props.max)}>
      <PosterIdentity poster={props.poster} channelId={props.channelId} rank={props.rank} />
      <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted" title={props.title}>{props.value ?? formatCount(props.poster.count)}</span>
    </li>
  );
}
