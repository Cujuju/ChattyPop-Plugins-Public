import { For, type Accessor, type JSX } from 'solid-js';
import { look } from '@plugin-sdk/renderer/kit';
import type { ActivityStats } from '../shared/types';
import styles from './Stats.module.css';

export interface StatsSectionProps {
  stats: Accessor<ActivityStats>;
}

const HEADING = { 'data-size': '2xs', 'data-weight': 'medium', 'data-case': 'upper', 'data-tracking': 'label', 'data-tone': 'muted' } as const;
export const CHART_LABEL = { 'data-size': '2xs', 'data-tone': 'muted' } as const;
export const SHARE_ROW = { 'data-size': 'sm', 'data-tone': 'primary' } as const;
const COUNT = new Intl.NumberFormat(undefined);

export const formatCount = (n: number): string => COUNT.format(n);
export const countLabel = (n: number, word: string, many = `${word}s`): string => `${formatCount(n)} ${n === 1 ? word : many}`;

/** Charts and ranked rows use the existing fraction variable. */
export const share = (n: number, max: number): Record<string, string> => ({ '--v': String(max ? n / max : 0) });

export function Subheading(props: { children: JSX.Element }) {
  return <h3 class={`${styles.heading} ${look.text}`} {...HEADING}>{props.children}</h3>;
}

export function CountRows(props: { rows: { name: string; count: number }[]; lead?: (name: string) => JSX.Element }) {
  const max = () => Math.max(0, ...props.rows.map((r) => r.count));
  return (
    <ul class={styles.list}>
      <For each={props.rows}>{(row) => (
        <li class={`${styles.row} ${look.shareBar} ${look.text}`} {...SHARE_ROW} style={share(row.count, max())}>
          <span class={styles.rowLead}>
            {props.lead?.(row.name)}
            <span class={styles.rowName}>{row.name}</span>
          </span>
          <span class={`${styles.rowCount} ${look.text}`} data-size="xs" data-tone="muted">{formatCount(row.count)}</span>
        </li>
      )}</For>
    </ul>
  );
}
