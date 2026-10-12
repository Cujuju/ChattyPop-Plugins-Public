import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum } from 'd3-force';
import { GRAPH_HEIGHT, GRAPH_RADIUS_MAX, GRAPH_WIDTH, graphInputs, type GraphNode } from './graphInputs';
import { graphCollisionRadius } from './graphLabels';
import type { ConversationStats } from '../shared/conversations';

/** Three hundred cooling steps settle the small graph without scheduling animation. */
export const GRAPH_TICKS = 300;
/** Repulsion spreads participants before their positions are mapped into the drawing. */
export const GRAPH_CHARGE = -(GRAPH_WIDTH * GRAPH_WIDTH) / 250;
export const GRAPH_LINK_DISTANCE = GRAPH_WIDTH / 6;
/** Five units clear the theme's node rings and heaviest edge strokes at this drawing scale. */
export const GRAPH_STROKE_CLEARANCE = GRAPH_WIDTH / 200;
/** Inward-facing labels need no outer reserve beyond the largest dot and its stroke clearance. */
export const GRAPH_LAYOUT_MARGIN = GRAPH_RADIUS_MAX + GRAPH_STROKE_CLEARANCE;

interface LayoutEdge extends SimulationLinkDatum<GraphNode> { exchanges: number; share: number }
export interface PlacedNode extends GraphNode { x: number; y: number }

/** Fill each drawing axis independently, centring an axis whose settled positions all coincide. */
export function scaleGraphNodes(nodes: readonly PlacedNode[]): PlacedNode[] {
  if (!nodes.length) return [];
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  const scaleAxis = (position: number, min: number, max: number, size: number): number =>
    min === max ? size / 2 : GRAPH_LAYOUT_MARGIN + (position - min) / (max - min) * (size - 2 * GRAPH_LAYOUT_MARGIN);
  return nodes.map((node) => ({
    ...node,
    x: scaleAxis(node.x, minX, maxX, GRAPH_WIDTH),
    y: scaleAxis(node.y, minY, maxY, GRAPH_HEIGHT),
  }));
}

export function graphLayout(stats: Pick<ConversationStats, 'people' | 'pairs'>) {
  const input = graphInputs(stats);
  if (!input.nodes.length) return { nodes: [] as PlacedNode[], edges: [] };
  const edges: LayoutEdge[] = input.edges.map((edge) => ({ ...edge }));
  const simulation = forceSimulation(input.nodes).stop()
    .force('center', forceCenter(GRAPH_WIDTH / 2, GRAPH_HEIGHT / 2))
    .force('charge', forceManyBody<GraphNode>().strength(GRAPH_CHARGE))
    .force('collide', forceCollide<GraphNode>().radius(graphCollisionRadius))
    .force('links', forceLink<GraphNode, LayoutEdge>(edges).id((node) => node.userId).distance(GRAPH_LINK_DISTANCE));
  simulation.tick(GRAPH_TICKS);
  const nodes = scaleGraphNodes(input.nodes.map((node) => ({ ...node, x: node.x!, y: node.y! })));
  const byId = new Map(nodes.map((node) => [node.userId, node]));
  return { nodes, edges: input.edges.map((edge) => ({ ...edge, first: byId.get(edge.source)!, second: byId.get(edge.target)! })) };
}
