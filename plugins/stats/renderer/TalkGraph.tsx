import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { look, openPerson, personName } from '@plugin-sdk/renderer/kit';
import type { ConversationStats } from '../shared/conversations';
import { GRAPH_SIZE } from './graphInputs';
import { graphLayout } from './graphLayout';
import { GRAPH_LABEL_BASELINE, GRAPH_LABEL_GAP, GRAPH_LABEL_SIZE, graphLabel } from './graphLabels';
import { countLabel, share } from './section';
import { fitViewBox } from './viewBox';
import styles from './Stats.module.css';

/** A small rim clears node/edge strokes while keeping the measured label bounds close to the viewport. */
const GRAPH_VIEWBOX_PADDING = GRAPH_SIZE / 64;

export function TalkGraph(props: { stats: ConversationStats; channelId: string | null }) {
  let svg!: SVGSVGElement;
  let drawing!: SVGGElement;
  let disposed = false;
  const fallback = { width: GRAPH_SIZE, height: GRAPH_SIZE };
  const [viewBox, setViewBox] = createSignal(fitViewBox(null, GRAPH_VIEWBOX_PADDING, fallback));
  const graph = createMemo(() => graphLayout({
    ...props.stats,
    people: props.stats.people.map((person) => ({ ...person, name: personName(person.userId, props.channelId)?.name ?? person.name })),
  }));
  const fit = (): void => {
    if (disposed || !drawing.isConnected) return;
    if (!graph().nodes.length) {
      setViewBox(fitViewBox(null, GRAPH_VIEWBOX_PADDING, fallback));
      return;
    }
    const bounds = drawing.getBBox();
    if (!bounds.width || !bounds.height) return;
    setViewBox(fitViewBox([{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }], GRAPH_VIEWBOX_PADDING, fallback));
  };
  onCleanup(() => { disposed = true; });
  createEffect(() => {
    graph();
    // Read after Solid has updated all node and label attributes, including scoped name changes.
    queueMicrotask(fit);
  });
  onMount(() => {
    const observer = new ResizeObserver(fit);
    observer.observe(svg);
    observer.observe(drawing);
    void document.fonts.ready.then(fit);
    document.fonts.addEventListener('loadingdone', fit);
    onCleanup(() => {
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', fit);
    });
  });
  return <svg ref={svg} class={styles.graph} viewBox={viewBox()} role="img" aria-label="People who exchange consecutive messages; ranked pairs follow">
    <g ref={drawing}>
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
          {graphLabel(node.name)}<title>{node.name}</title>
        </text>
      </>}</For>
    </g>
  </svg>;
}
