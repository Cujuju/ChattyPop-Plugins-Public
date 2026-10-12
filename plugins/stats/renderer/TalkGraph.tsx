import { For, createMemo } from 'solid-js';
import { look, openPerson, personName } from '@plugin-sdk/renderer/kit';
import type { ConversationStats } from '../shared/conversations';
import { GRAPH_HEIGHT, GRAPH_WIDTH } from './graphInputs';
import { graphLayout } from './graphLayout';
import { GRAPH_LABEL_BASELINE, GRAPH_LABEL_GAP, GRAPH_LABEL_SIZE, graphLabel } from './graphLabels';
import { countLabel, share } from './section';
import styles from './Stats.module.css';

export function TalkGraph(props: { stats: ConversationStats; channelId: string | null }) {
  const graph = createMemo(() => graphLayout({
    ...props.stats,
    people: props.stats.people.map((person) => ({ ...person, name: personName(person.userId, props.channelId)?.name ?? person.name })),
  }));
  return <svg class={styles.graph} viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} role="img" aria-label="People who exchange consecutive messages; ranked pairs follow">
    <g>
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
        <text class={look.graphLabel} x={node.x + (node.x < GRAPH_WIDTH / 2 ? 1 : -1) * (node.r + GRAPH_LABEL_GAP)}
          y={node.y + GRAPH_LABEL_BASELINE} text-anchor={node.x < GRAPH_WIDTH / 2 ? 'start' : 'end'} font-size={String(GRAPH_LABEL_SIZE)}>
          {graphLabel(node.name)}<title>{node.name}</title>
        </text>
      </>}</For>
    </g>
  </svg>;
}
