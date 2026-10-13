import { For, Show, createMemo } from 'solid-js';
import { pluginResource } from '@plugin-sdk/renderer';
import { SegButton, SegGroup, formatBytes, look } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import type { BreakdownBy, BreakdownRow } from '../shared/types';
import { BREAKDOWN_ROWS, breakdownBy, breakdownRevision, filter, setBreakdownBy, setWhere, setWho, where, who } from './state';
import styles from './Attachments.module.css';

export function Breakdown() {
  const rows = pluginResource(plugin, 'breakdown', () => {
    breakdownRevision();
    return [{ ...filter(), by: breakdownBy(), limit: BREAKDOWN_ROWS }];
  }, [] as BreakdownRow[]);
  const max = createMemo(() => Math.max(0, ...rows().map((r) => r.bytes)));
  const current = (row: BreakdownRow): boolean => breakdownBy() === 'author' ? who() === row.id : where()?.by === breakdownBy() && where()?.id === row.id;
  const pick = (row: BreakdownRow): void => {
    if (!row.id) return;
    const by = breakdownBy();
    if (by === 'author') setWho(row.id);
    else setWhere({ by, id: row.id });
  };
  return (
    <div class={styles.breakdown}>
      <div class={styles.breakdownHead}>
        <SegGroup role="radiogroup" ariaLabel="By" value={breakdownBy()} onChange={(value: BreakdownBy) => setBreakdownBy(value)}>
          <SegButton value="guild" label="Server" size="sm" /><SegButton value="channel" label="Channel" size="sm" /><SegButton value="author" label="Person" size="sm" />
        </SegGroup>
        <span class={look.text} data-size="2xs" data-tone="muted">by size on this PC</span>
      </div>
      <div class={styles.breakdownRows}>
        <For each={rows()}>{(row) => (
          <button type="button" class={`${styles.breakdownRow} ${look.shareBar}`} style={{ '--v': max() ? row.bytes / max() : 0 }}
            aria-current={current(row) ? 'true' : undefined} onClick={() => pick(row)}>
            <span class={`${styles.breakdownName} ${look.text}`} data-size="xs">{row.name}</span>
            <Show when={row.detail}><span class={`${styles.breakdownDetail} ${look.text}`} data-size="2xs" data-tone="muted">{row.detail}</span></Show>
            <span class={`${styles.breakdownFigure} ${look.text}`} data-size="2xs" data-figures="tabular">{formatBytes(row.bytes)} · {row.count} files</span>
          </button>
        )}</For>
      </div>
    </div>
  );
}
