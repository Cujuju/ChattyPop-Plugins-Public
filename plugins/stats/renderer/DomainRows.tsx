import { For, Show } from 'solid-js';
import { BrandIcon, look } from '@plugin-sdk/renderer/kit';
import type { ActivityStats } from '../shared/types';
import { SHARE_ROW, formatCount, share } from './section';
import styles from './Stats.module.css';

type Site = ActivityStats['domains'][number];

function SiteRow(props: { site: Site }) {
  return <>
    <span class={styles.rowLead}><BrandIcon domain={props.site.domain} /><span class={styles.rowName}>{props.site.domain}</span></span>
    <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{formatCount(props.site.count)}</span>
  </>;
}

export function DomainRows(props: { sites: Site[] }) {
  const max = () => props.sites[0]?.count ?? 0;
  return <ul class={styles.list}>
    <For each={props.sites}>{(site) => <li>
      <Show when={site.hosts.length !== 1 || site.hosts[0]!.host !== site.domain} fallback={
        <div class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(site.count, max())}><SiteRow site={site} /></div>
      }>
        <details>
          <summary class={`${styles.siteSummary} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(site.count, max())}>
            <span class={styles.row}><SiteRow site={site} /></span>
          </summary>
          <ul class={`${styles.list} ${styles.hostList}`}>
            <For each={site.hosts}>{(host) => <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(host.count, site.count)}>
              <span class={styles.rowName}>{host.host}</span>
              <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{formatCount(host.count)}</span>
            </li>}</For>
          </ul>
        </details>
      </Show>
    </li>}</For>
  </ul>;
}
