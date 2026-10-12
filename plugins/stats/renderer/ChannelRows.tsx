import { For } from 'solid-js';
import { look, openArchive } from '@plugin-sdk/renderer/kit';
import type { StatsChannel } from '../shared/types';
import { SHARE_ROW, share } from './section';
import styles from './Stats.module.css';

export function ChannelRows(props: { channels: StatsChannel[] }) {
  const max = () => props.channels[0]?.count ?? 0;
  return (
    <ul class={styles.list}>
      <For each={props.channels}>{(channel) => (
        <li>
          <button type="button" class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW}
            style={share(channel.count, max())} title="Open channel in the Archive" onClick={() => void openArchive(channel.channelId)}>
            <span class={styles.rowName}>{channel.name}</span>
            <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{channel.count}</span>
          </button>
        </li>
      )}</For>
    </ul>
  );
}
