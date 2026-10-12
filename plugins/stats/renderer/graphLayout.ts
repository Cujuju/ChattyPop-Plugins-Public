import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum } from 'd3-force';
import { GRAPH_SIZE, graphInputs, type GraphNode } from './graphInputs';
import { graphCollisionRadius } from './graphLabels';
import type { ConversationStats } from '../shared/conversations';

/** Three hundred cooling steps settle the small graph without scheduling animation. */
export const GRAPH_TICKS = 300;
/** Repulsion spreads participants; label collisions may extend links beyond this target distance. */
export const GRAPH_CHARGE = -(GRAPH_SIZE * GRAPH_SIZE) / 250;
export const GRAPH_LINK_DISTANCE = GRAPH_SIZE / 6;

interface LayoutEdge extends SimulationLinkDatum<GraphNode> { exchanges: number; share: number }
export interface PlacedNode extends GraphNode { x: number; y: number }

export function graphLayout(stats: Pick<ConversationStats, 'people' | 'pairs'>) {
  const input = graphInputs(stats);
  if (!input.nodes.length) return { nodes: [] as PlacedNode[], edges: [] };
  const edges: LayoutEdge[] = input.edges.map((edge) => ({ ...edge }));
  const simulation = forceSimulation(input.nodes).stop()
    .force('center', forceCenter(GRAPH_SIZE / 2, GRAPH_SIZE / 2))
    .force('charge', forceManyBody<GraphNode>().strength(GRAPH_CHARGE))
    .force('collide', forceCollide<GraphNode>().radius(graphCollisionRadius))
    .force('links', forceLink<GraphNode, LayoutEdge>(edges).id((node) => node.userId).distance(GRAPH_LINK_DISTANCE));
  simulation.tick(GRAPH_TICKS);
  // Keep the collision distances intact; the renderer fits the resulting drawing rather than shrinking positions.
  const nodes: PlacedNode[] = input.nodes.map((node) => ({ ...node, x: node.x!, y: node.y! }));
  const byId = new Map(nodes.map((node) => [node.userId, node]));
  return { nodes, edges: input.edges.map((edge) => ({ ...edge, first: byId.get(edge.source)!, second: byId.get(edge.target)! })) };
}
