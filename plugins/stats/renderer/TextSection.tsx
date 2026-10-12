import { Show, type Accessor, type JSX } from 'solid-js';
import type { PluginResource } from '@plugin-sdk/renderer';
import { look } from '@plugin-sdk/renderer/kit';
import type { TextCoverage } from '../shared/text';
import { countLabel } from './section';
import styles from './Stats.module.css';

export function TextSection<T extends TextCoverage>(props: { label: string; resource: PluginResource<T | null>; children: (stats: Accessor<T>) => JSX.Element }) {
  return <section class={styles.section} aria-label={props.label} aria-busy={props.resource.loading}>
    <Show when={props.resource.failure}><p class="cp-error" role="alert">Couldn't load {props.label}. {props.resource.failure}</p></Show>
    <Show when={props.resource.loading && !props.resource()}><p class={look.text} data-size="sm" data-tone="muted" role="status">Loading {props.label}…</p></Show>
    <Show when={props.resource()}>{(stats) => <>
      <p class={look.text} data-size="xs" data-tone="muted">Read text from {countLabel(stats().textMessages, 'archived message')}.</p>
      {props.children(stats)}
    </>}</Show>
  </section>;
}
