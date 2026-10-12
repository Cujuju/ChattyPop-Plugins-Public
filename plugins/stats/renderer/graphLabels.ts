import { GRAPH_SIZE } from './graphInputs';

/** Short labels leave full names in titles and the accessible pair rows. */
export const GRAPH_LABEL_CHARACTERS = 18;
export const GRAPH_LABEL_SIZE = GRAPH_SIZE / 50;
export const GRAPH_LABEL_GAP = GRAPH_SIZE / 200;
export const GRAPH_LABEL_BASELINE = GRAPH_SIZE / 150;
/** One em per capped character plus the ellipsis reserves room for wide names beside their nodes. */
export const GRAPH_LABEL_COLLISION_PADDING = GRAPH_LABEL_SIZE * (GRAPH_LABEL_CHARACTERS + 1);

export function graphLabel(name: string): string {
  const letters = Array.from(name);
  return letters.length > GRAPH_LABEL_CHARACTERS ? `${letters.slice(0, GRAPH_LABEL_CHARACTERS).join('')}…` : name;
}

/** A disk enclosing the label's estimated width and height; short names need less space than capped ones. */
export function graphCollisionRadius(node: { name: string; r: number }): number {
  const width = Math.min(Array.from(graphLabel(node.name)).length * GRAPH_LABEL_SIZE, GRAPH_LABEL_COLLISION_PADDING);
  return Math.hypot(node.r + GRAPH_LABEL_GAP + width, GRAPH_LABEL_SIZE);
}
