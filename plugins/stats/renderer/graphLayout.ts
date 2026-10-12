import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum } from 'd3-force';
import { GRAPH_SIZE, graphInputs, type GraphNode } from './graphInputs';
import type { ConversationStats } from '../shared/conversations';

/** Three hundred cooling steps settle the small graph without scheduling animation. */
export const GRAPH_TICKS = 300;
/** The margin reserves label room; collision spacing keeps neighboring dots distinct. */
export const GRAPH_MARGIN = GRAPH_SIZE / 10;
export const GRAPH_COLLISION_PADDING = GRAPH_SIZE / 40;
/** Repulsion spreads twenty people; the link length leaves room for their names. */
export const GRAPH_CHARGE = -(GRAPH_SIZE * GRAPH_SIZE) / 250;
export const GRAPH_LINK_DISTANCE = GRAPH_SIZE / 6;

interface LayoutEdge extends SimulationLinkDatum<GraphNode> { count: number; share: number }
export interface PlacedNode extends GraphNode { x: number; y: number }

export function graphLayout(stats: Pick<ConversationStats, 'people' | 'pairs'>) {
  const input = graphInputs(stats);
  if (!input.nodes.length) return { nodes: [] as PlacedNode[], edges: [] };
  const edges: LayoutEdge[] = input.edges.map((edge) => ({ ...edge }));
  const simulation = forceSimulation(input.nodes).stop()
    .force('center', forceCenter(GRAPH_SIZE / 2, GRAPH_SIZE / 2))
    .force('charge', forceManyBody<GraphNode>().strength(GRAPH_CHARGE))
    .force('collide', forceCollide<GraphNode>().radius((node) => node.r + GRAPH_COLLISION_PADDING))
    .force('links', forceLink<GraphNode, LayoutEdge>(edges).id((node) => node.userId).distance(GRAPH_LINK_DISTANCE));
  simulation.tick(GRAPH_TICKS);
  const xs = input.nodes.map((node) => node.x!);
  const ys = input.nodes.map((node) => node.y!);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const span = Math.max(right - left, bottom - top);
  const scale = span > 0 ? (GRAPH_SIZE - GRAPH_MARGIN * 2) / span : 1;
  // Normalization preserves the layout; bounding only absorbs floating-point roundoff at its margin.
  const bound = (value: number): number => Math.max(GRAPH_MARGIN, Math.min(GRAPH_SIZE - GRAPH_MARGIN, value));
  const nodes: PlacedNode[] = input.nodes.map((node) => ({
    ...node, x: bound(GRAPH_SIZE / 2 + (node.x! - (left + right) / 2) * scale),
    y: bound(GRAPH_SIZE / 2 + (node.y! - (top + bottom) / 2) * scale),
  }));
  const byId = new Map(nodes.map((node) => [node.userId, node]));
  return { nodes, edges: input.edges.map((edge) => ({ ...edge, first: byId.get(edge.source)!, second: byId.get(edge.target)! })) };
}
