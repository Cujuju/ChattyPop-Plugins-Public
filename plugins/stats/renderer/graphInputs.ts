import type { ConversationPerson, ConversationStats } from '../shared/conversations';

/** Twenty people keep names and ties legible within the drawing. */
export const GRAPH_PEOPLE_MAX = 20;
/** The theme's edge and node line widths assume a viewBox about a thousand units across. */
export const GRAPH_WIDTH = 1000;
/** Height is two thirds of the width; the SVG element takes its shape from the viewBox. */
export const GRAPH_HEIGHT_RATIO = 2 / 3;
export const GRAPH_HEIGHT = GRAPH_WIDTH * GRAPH_HEIGHT_RATIO;
/** Dot areas follow exchange totals; these bounds leave both weak and strong participants visible. */
export const GRAPH_RADIUS_MIN = GRAPH_WIDTH / 100;
export const GRAPH_RADIUS_MAX = GRAPH_WIDTH / 40;

export interface GraphNode extends ConversationPerson {
  r: number;
  x?: number;
  y?: number;
}
export interface GraphEdge {
  source: string;
  target: string;
  exchanges: number;
  share: number;
}

/** Add endpoints together in pair rank order so the node cap never creates isolated participants. */
export function graphInputs(stats: Pick<ConversationStats, 'people' | 'pairs'>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const people = new Map(stats.people.map((person) => [person.userId, person]));
  const pairs = stats.pairs.slice().sort((a, b) => b.exchanges - a.exchanges || a.first.userId.localeCompare(b.first.userId) || a.second.userId.localeCompare(b.second.userId));
  const selected = new Set<string>();
  for (const pair of pairs) {
    const ids = [pair.first.userId, pair.second.userId];
    if (pair.exchanges <= 0 || ids[0] === ids[1] || ids.some((id) => !people.has(id))) continue;
    const added = ids.filter((id) => !selected.has(id));
    if (selected.size + added.length <= GRAPH_PEOPLE_MAX) ids.forEach((id) => selected.add(id));
  }
  const ranked = [...selected].map((id) => people.get(id)!).sort((a, b) => b.exchanges - a.exchanges || a.userId.localeCompare(b.userId));
  const max = Math.max(0, ...ranked.map((person) => person.exchanges));
  const nodes = ranked.map((person) => ({ ...person, r: GRAPH_RADIUS_MIN + (GRAPH_RADIUS_MAX - GRAPH_RADIUS_MIN) * Math.sqrt(max ? person.exchanges / max : 0) }));
  const visible = pairs.filter((pair) => pair.exchanges > 0 && selected.has(pair.first.userId) && selected.has(pair.second.userId));
  const strongest = visible[0]?.exchanges ?? 0;
  const edges = visible.map((pair) => ({ source: pair.first.userId, target: pair.second.userId, exchanges: pair.exchanges, share: pair.exchanges / strongest }));
  return { nodes, edges };
}
