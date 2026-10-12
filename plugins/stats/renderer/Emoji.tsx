import { For } from 'solid-js';
import { ChatEmoji, look } from '@plugin-sdk/renderer/kit';
import { emoji } from './state';
import { TextSection } from './TextSection';
import { CountRows, SHARE_ROW, Subheading, formatCount, share } from './section';
import styles from './Stats.module.css';

export function Emoji() {
  return <TextSection label="Emoji" resource={emoji}>{(stats) => <>
    <CountRows rows={[{ name: 'Custom emoji', count: stats().custom }, { name: 'Unicode emoji', count: stats().unicode }]} />
    <Subheading>Top emoji</Subheading>
    <ol class={styles.list}>
      <For each={stats().emoji}>{(entry) => <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(entry.count, stats().emoji[0]?.count ?? 0)}>
        <span class={styles.rowLead}><ChatEmoji emoji={entry} /><span class={styles.rowName}>{entry.id ? `:${entry.name}:` : entry.name}</span></span>
        <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{formatCount(entry.count)}</span>
      </li>}</For>
    </ol>
  </>}</TextSection>;
}
