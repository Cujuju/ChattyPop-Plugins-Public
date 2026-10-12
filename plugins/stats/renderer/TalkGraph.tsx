import { For, createMemo } from 'solid-js';
import { look, openPerson, personName } from '@plugin-sdk/renderer/kit';
import type { ConversationStats } from '../shared/conversations';
import { GRAPH_SIZE } from './graphInputs';
import { graphLayout } from './graphLayout';
import { countLabel, share } from './section';
import styles from './Stats.module.css';

/** Short labels leave full names in titles and the accessible pair rows. */
const GRAPH_LABEL_CHARACTERS = 18;
const GRAPH_LABEL_SIZE = GRAPH_SIZE / 50;
const GRAPH_LABEL_GAP = GRAPH_SIZE / 200;
const GRAPH_LABEL_BASELINE = GRAPH_SIZE / 150;

export function TalkGraph(props: { stats: ConversationStats; channelId: string | null }) {
  const graph = createMemo(() => graphLayout({
    ...props.stats,
    people: props.stats.people.map((person) => ({ ...person, name: personName(person.userId, props.channelId)?.name ?? person.name })),
  }));
  const label = (name: string): string => {
    const letters = Array.from(name);
    return letters.length > GRAPH_LABEL_CHARACTERS ? `${letters.slice(0, GRAPH_LABEL_CHARACTERS).join('')}…` : name;
  };
  return <svg class={styles.graph} viewBox={`0 0 ${GRAPH_SIZE} ${GRAPH_SIZE}`} role="img" aria-label="People who exchange consecutive messages; ranked pairs follow">
    <For each={graph().edges}>{(edge) => <line class={look.graphEdge} x1={edge.first.x} y1={edge.first.y} x2={edge.second.x} y2={edge.second.y} style={share(edge.share, 1)}>
      <title>{edge.first.name} and {edge.second.name}: {countLabel(edge.exchanges, 'exchange')}</title>
    </line>}</For>
    <For each={graph().nodes}>{(node) => <>
      <circle class={look.graphNode} cx={node.x} cy={node.y} r={node.r} role="button" tabindex="0" aria-label={`Open ${node.name}'s Person window`}
        onClick={() => openPerson(node.userId, props.channelId)} onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          openPerson(node.userId, props.channelId);
        }}><title>{node.name}: {countLabel(node.exchanges, 'total exchange')}</title></circle>
      <text class={look.graphLabel} x={node.x + (node.x < GRAPH_SIZE / 2 ? 1 : -1) * (node.r + GRAPH_LABEL_GAP)}
        y={node.y + GRAPH_LABEL_BASELINE} text-anchor={node.x < GRAPH_SIZE / 2 ? 'start' : 'end'} font-size={String(GRAPH_LABEL_SIZE)}>
        {label(node.name)}<title>{node.name}</title>
      </text>
    </>}</For>
  </svg>;
}
