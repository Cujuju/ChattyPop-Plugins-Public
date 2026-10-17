import { For, Show } from 'solid-js';
import { batchWrites } from '@plugin-sdk/renderer';
import { AuthorName, GuildIcon, Icon, PersonFace, SegButton, SegGroup, channelById, channelSigil, directory, formatBytes, look, personName } from '@plugin-sdk/renderer/kit';
import type { AttachmentBreakdown, AttachmentKind, BreakdownBy } from '../shared/types';
import { breakdown, breakdownBy, setBreakdownBy, setKinds, setSpaceView, setWhere, setWho, where } from './state';
import { KIND_ICON } from './AttachmentPicture';
import styles from './Space.module.css';

const DIMENSIONS: { value: BreakdownBy; label: string }[] = [
  { value: 'guild', label: 'By server' }, { value: 'channel', label: 'Channel' }, { value: 'person', label: 'Person' }, { value: 'kind', label: 'Kind' },
];
const COUNT = new Intl.NumberFormat();
const EMPTY_NAME = { color: null, gradient: null, font: null };

export function SpaceView() {
  const place = () => where()?.by === 'channel' ? where()!.id : null;
  const guild = (key: string) => directory().find((g) => g.id === key);
  const pick = (row: AttachmentBreakdown): void => {
    if (row.key === null) return;
    batchWrites(() => {
      if (breakdownBy() === 'person') setWho(row.key);
      else if (breakdownBy() === 'kind') setKinds([row.key as AttachmentKind]);
      else setWhere({ by: breakdownBy() as 'guild' | 'channel', id: row.key! });
      setSpaceView(false);
    });
  };
  const label = (row: AttachmentBreakdown) => breakdownBy() === 'channel'
    ? `${channelById(row.key ?? '') ? channelSigil(channelById(row.key ?? '')!) : '#'}${row.label}` : row.label;
  return <div class={styles.space} aria-label="Attachment disk space">
    <SegGroup role="radiogroup" ariaLabel="Group disk space" value={breakdownBy()} onChange={(by: BreakdownBy) => setBreakdownBy(by)}>
      <For each={DIMENSIONS}>{(d) => <SegButton value={d.value} label={d.label} size="sm" />}</For>
    </SegGroup>
    <Show when={!breakdown.loading && !breakdown.failure}>
      <p class={`${styles.summary} ${look.text}`} data-size="sm" data-figures="tabular">
        {formatBytes(breakdown()[0]?.totalBytes ?? 0)} in {countLabel(breakdown()[0]?.totalCount ?? 0)}
      </p>
    </Show>
    <Show when={breakdown.loading}><p class="cp-panel-empty" role="status">Loading…</p></Show>
    <Show when={breakdown.failure}><p class="cp-panel-empty" role="alert" title={breakdown.failure ?? undefined}>Attachments couldn’t be read.</p></Show>
    <Show when={!breakdown.loading && !breakdown.failure}>
      <Show when={breakdown().length} fallback={<p class="cp-panel-empty">No attachments match these filters.</p>}>
        <ul class={styles.ranked}>
          <For each={breakdown()}>{(row) => <li>
            <Show when={row.key !== null} fallback={<div class={`${styles.row} ${look.text}`} data-size="sm">
              <span>Other · {COUNT.format(row.groups ?? 0)} more</span><Size row={row} />
            </div>}>
              <button type="button" class={`${styles.row} ${look.shareBar} ${look.text}`} data-size="sm" data-tone="primary"
                style={{ '--v': String(breakdown()[0]?.bytes ? row.bytes / breakdown()[0]!.bytes : 0) }}
                title={`Show ${label(row)} files`} onClick={() => pick(row)}>
                <span class={styles.lead}>
                  <Show when={breakdownBy() === 'guild'}><span class={styles.mark}><GuildIcon id={row.key!} name={row.label} icon={guild(row.key!)?.icon ?? null} /></span></Show>
                  <Show when={breakdownBy() === 'person'}><Show when={row.key} fallback={<Icon name="person" class={styles.mark} />}><PersonFace userId={row.key!} channelId={place()} class={styles.mark} /></Show></Show>
                  <Show when={breakdownBy() === 'kind'}><Icon name={KIND_ICON[row.key as AttachmentKind]} class={styles.mark} /></Show>
                  <Show when={breakdownBy() === 'person'} fallback={<span class={styles.name}>{label(row)}</span>}>
                    <AuthorName class={styles.name} author={row.key && personName(row.key, place()) || { ...EMPTY_NAME, name: row.label }} />
                  </Show>
                </span>
                <Size row={row} />
              </button>
            </Show>
          </li>}</For>
        </ul>
      </Show>
    </Show>
  </div>;
}

function Size(props: { row: AttachmentBreakdown }) {
  return <span class={styles.size}>
    <span class={look.text} data-figures="tabular" data-tone="primary">{formatBytes(props.row.bytes)}</span>
    <span class={look.text} data-figures="tabular" data-size="xs" data-tone="muted">{countLabel(props.row.count)}</span>
  </span>;
}

const countLabel = (count: number): string => `${COUNT.format(count)} ${count === 1 ? 'file' : 'files'}`;
