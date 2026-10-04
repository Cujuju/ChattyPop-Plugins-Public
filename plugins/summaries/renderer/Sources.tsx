// A summary's sources: cited messages behind a toggle, each a chip opening the message in the Archive.
import { For, Show, createSignal } from 'solid-js';
import { clockTime, countText, look, openArchive, personName, shortDateTime } from '@plugin-sdk/renderer/kit';
import type { Citation, Summary } from '../shared/types';
import styles from './Summary.module.css';

/** Run details: muted small print. */
const META = { 'data-size': 'xs', 'data-line': 'normal', 'data-font': 'sans', 'data-tone': 'muted' } as const;
/** A chip's text. */
const CHIP = { 'data-size': '2xs', 'data-line': 'chip', 'data-font': 'sans' } as const;

/** A part's cited messages behind one toggle ("3 sources"); expanded, the chips, at most `limit` of them. */
export function Sources(props: { citations: Citation[]; summary: Summary; withDay: boolean; limit?: number }) {
  const [open, setOpen] = createSignal(false);
  const shown = () => (props.limit === undefined ? props.citations : props.citations.slice(0, props.limit));
  return (
    <Show when={props.citations.length}>
      <button type="button" class={`${styles.cite} ${look.citation} ${look.text}`} {...CHIP} aria-expanded={open()} onClick={() => setOpen(!open())}>
        {open() ? 'Hide sources' : countText(props.citations.length, 'source')}
      </button>
      <Show when={open()}>
        <For each={shown()}>{(c) => <CitationChip citation={c} summary={props.summary} withDay={props.withDay} />}</For>
        <Show when={props.citations.length - shown().length}>{(more) => <span class={`${styles.meta} ${look.text}`} {...META}> +{more()} more</span>}</Show>
      </Show>
    </Show>
  );
}

/** A source: its channel, its author's name there now (live) and its time; opens the message. */
function CitationChip(props: { citation: Citation; summary: Summary; withDay: boolean }) {
  const author = (): string | undefined => {
    const id = props.summary.authors[props.citation.messageId];
    return id === undefined ? undefined : (personName(id, props.citation.channelId)?.name ?? props.summary.people[id]);
  };
  return (
    <button
      type="button"
      class={`${styles.cite} ${look.citation} ${look.text}`}
      {...CHIP}
      title="Open this message in the Archive"
      onClick={() => void openArchive(props.citation.channelId, props.citation.messageId)}
    >
      #{props.citation.channelName}
      <Show when={author()}>{(name) => ` · ${name()}`}</Show> {props.withDay ? shortDateTime(props.citation.ts) : clockTime(props.citation.ts)}
    </button>
  );
}
