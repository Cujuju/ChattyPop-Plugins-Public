import { Show, type JSX } from 'solid-js';
import { statsAuthor } from './state';

/** Single-person queries suppress headings and lists whose only result would be that person. */
export function PeopleRanking(props: { children: JSX.Element }) {
  return <Show when={statsAuthor() === null}>{props.children}</Show>;
}
