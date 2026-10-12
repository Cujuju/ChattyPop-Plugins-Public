import { GRAPH_WIDTH } from './graphInputs';

/** Short labels leave full names in titles and the accessible pair rows. */
export const GRAPH_LABEL_CHARACTERS = 18;
export const GRAPH_LABEL_SIZE = GRAPH_WIDTH / 50;
export const GRAPH_LABEL_GAP = GRAPH_WIDTH / 200;
export const GRAPH_LABEL_BASELINE = GRAPH_WIDTH / 150;
/** Reserve one label height beyond each dot during simulation, without enclosing the full name. */
export const GRAPH_COLLISION_GAP = GRAPH_LABEL_SIZE;

export function graphLabel(name: string): string {
  const letters = Array.from(name);
  return letters.length > GRAPH_LABEL_CHARACTERS ? `${letters.slice(0, GRAPH_LABEL_CHARACTERS).join('')}…` : name;
}

export function graphCollisionRadius(node: { r: number }): number {
  return node.r + GRAPH_COLLISION_GAP;
}
