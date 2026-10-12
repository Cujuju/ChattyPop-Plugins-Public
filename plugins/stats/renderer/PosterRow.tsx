import { Avatar, PersonName, look } from '@plugin-sdk/renderer/kit';
import type { StatsPoster } from '../shared/types';
import { SHARE_ROW, formatCount, share } from './section';
import styles from './Stats.module.css';

export function PosterRow(props: { poster: StatsPoster; channelId: string | null; rank: number; max: number }) {
  return (
    <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(props.poster.count, props.max)}>
      <span class={styles.posterIdentity}>
        <span class={styles.rowCount}>{formatCount(props.rank)}.</span>
        <Avatar author={{
          id: props.poster.userId, name: props.poster.name, username: null, avatar: props.poster.avatar,
          color: null, gradient: null, font: null, decoration: null, roleIcon: null, tag: null, app: null,
        }} />
        <PersonName userId={props.poster.userId} channelId={props.channelId} fallback={props.poster.name} class={styles.rowName} />
      </span>
      <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{formatCount(props.poster.count)}</span>
    </li>
  );
}
