import { describe, expect, it } from 'vitest';
import type { ConversationPerson } from '../shared/conversations';
import { graphInputs, GRAPH_HEIGHT, GRAPH_WIDTH, GRAPH_PEOPLE_MAX, GRAPH_RADIUS_MIN, GRAPH_RADIUS_MAX } from '../renderer/graphInputs';
import { GRAPH_LAYOUT_MARGIN, graphLayout, scaleGraphNodes } from '../renderer/graphLayout';
import { GRAPH_COLLISION_GAP, GRAPH_LABEL_CHARACTERS, GRAPH_LABEL_SIZE, graphCollisionRadius, graphLabel } from '../renderer/graphLabels';

const person = (index: number, exchanges: number): ConversationPerson => ({ userId: String(index), name: `Person ${index}`, avatar: null, exchanges });

describe('Analytics talk graph inputs', () => {
  it('normalizes edge strength, scales dots, caps people and keeps both endpoints of every edge', () => {
    const people = Array.from({ length: GRAPH_PEOPLE_MAX + 4 }, (_, index) => person(index, index + 1));
    const pairs = people.slice(1).map((second, index) => ({ first: people[0]!, second, exchanges: people.length - index }));
    const copy = structuredClone({ people, pairs });
    const input = graphInputs({ people, pairs });
    expect(input.nodes).toHaveLength(GRAPH_PEOPLE_MAX);
    expect(input.edges).toHaveLength(GRAPH_PEOPLE_MAX - 1);
    expect(input.edges[0]!.share).toBe(1);
    expect(input.edges.at(-1)!.share).toBe(input.edges.at(-1)!.exchanges / input.edges[0]!.exchanges);
    const ids = new Set(input.nodes.map((node) => node.userId));
    expect(input.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
    expect(input.nodes.every((node) => node.r >= GRAPH_RADIUS_MIN && node.r <= GRAPH_RADIUS_MAX)).toBe(true);
    expect({ people, pairs }).toEqual(copy);
    expect(graphInputs({ people: [], pairs: [] })).toEqual({ nodes: [], edges: [] });
    expect(graphLayout({ people: [], pairs: [] })).toEqual({ nodes: [], edges: [] });
  });

  it('produces finite positions deterministically without mutating core results', () => {
    const people = [person(1, 3), person(2, 2), person(3, 1)];
    const stats = { people, pairs: [{ first: people[0]!, second: people[1]!, exchanges: 2 }, { first: people[0]!, second: people[2]!, exchanges: 1 }] };
    const copy = structuredClone(stats);
    const first = graphLayout(stats);
    expect(graphLayout(stats)).toEqual(first);
    expect(first.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    expect(stats).toEqual(copy);
  });

  it('fills both drawing axes within the margin and connects edges to the scaled nodes', () => {
    const people = [person(1, 3), person(2, 2), person(3, 1)];
    const graph = graphLayout({ people, pairs: [{ first: people[0]!, second: people[1]!, exchanges: 2 }, { first: people[0]!, second: people[2]!, exchanges: 1 }] });
    expect(Math.min(...graph.nodes.map((node) => node.x))).toBeCloseTo(GRAPH_LAYOUT_MARGIN);
    expect(Math.max(...graph.nodes.map((node) => node.x))).toBeCloseTo(GRAPH_WIDTH - GRAPH_LAYOUT_MARGIN);
    expect(Math.min(...graph.nodes.map((node) => node.y))).toBeCloseTo(GRAPH_LAYOUT_MARGIN);
    expect(Math.max(...graph.nodes.map((node) => node.y))).toBeCloseTo(GRAPH_HEIGHT - GRAPH_LAYOUT_MARGIN);
    for (const edge of graph.edges) {
      expect(edge.first).toBe(graph.nodes.find((node) => node.userId === edge.source));
      expect(edge.second).toBe(graph.nodes.find((node) => node.userId === edge.target));
    }
  });

  it('keeps every dot and its stroke clearance inside the fixed drawing at the people cap', () => {
    const people = Array.from({ length: GRAPH_PEOPLE_MAX }, (_, index) => person(index, index + 1));
    const pairs = people.slice(1).map((second, index) => ({ first: people[0]!, second, exchanges: people.length - index }));
    const graph = graphLayout({ people, pairs });
    expect(graph.nodes).toHaveLength(GRAPH_PEOPLE_MAX);
    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(GRAPH_LAYOUT_MARGIN);
      expect(node.x).toBeLessThanOrEqual(GRAPH_WIDTH - GRAPH_LAYOUT_MARGIN);
      expect(node.y).toBeGreaterThanOrEqual(GRAPH_LAYOUT_MARGIN);
      expect(node.y).toBeLessThanOrEqual(GRAPH_HEIGHT - GRAPH_LAYOUT_MARGIN);
    }
  });

  it('keeps layout geometry independent of label lengths', () => {
    const people = [person(1, 3), person(2, 2), person(3, 1)];
    const pairs = [{ first: people[0]!, second: people[1]!, exchanges: 2 }, { first: people[0]!, second: people[2]!, exchanges: 1 }];
    const positions = graphLayout({ people, pairs }).nodes.map(({ x, y, r }) => ({ x, y, r }));
    const renamed = people.map((node, index) => ({ ...node, name: index ? 'W'.repeat(GRAPH_LABEL_CHARACTERS + 4) : 'Theo' }));
    expect(graphLayout({ people: renamed, pairs }).nodes.map(({ x, y, r }) => ({ x, y, r }))).toEqual(positions);
  });
});

describe('Analytics graph scaling', () => {
  it('centres one node without changing its radius or mutating the settled position', () => {
    const nodes = [{ ...person(1, 3), r: GRAPH_RADIUS_MAX, x: -420, y: 950 }];
    const copy = structuredClone(nodes);
    expect(scaleGraphNodes(nodes)).toEqual([{ ...nodes[0], x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 }]);
    expect(nodes).toEqual(copy);
    expect(scaleGraphNodes([])).toEqual([]);
  });

  it.each(['horizontal', 'vertical'] as const)('centres the degenerate axis of %s collinear nodes and fills the other', (direction) => {
    const nodes = [-40, 0, 60].map((position, index) => ({
      ...person(index, 1), r: GRAPH_RADIUS_MIN,
      x: direction === 'horizontal' ? position : -5,
      y: direction === 'vertical' ? position : -5,
    }));
    const copy = structuredClone(nodes);
    const scaled = scaleGraphNodes(nodes);
    const axis = direction === 'horizontal' ? 'x' : 'y';
    const centredAxis = direction === 'horizontal' ? 'y' : 'x';
    const size = direction === 'horizontal' ? GRAPH_WIDTH : GRAPH_HEIGHT;
    const centredSize = direction === 'horizontal' ? GRAPH_HEIGHT : GRAPH_WIDTH;
    expect(scaled.every((node) => node[centredAxis] === centredSize / 2)).toBe(true);
    expect(scaled[0]![axis]).toBeCloseTo(GRAPH_LAYOUT_MARGIN);
    expect(scaled[1]![axis]).toBeCloseTo(GRAPH_LAYOUT_MARGIN + (size - 2 * GRAPH_LAYOUT_MARGIN) * 0.4);
    expect(scaled[2]![axis]).toBeCloseTo(size - GRAPH_LAYOUT_MARGIN);
    expect(nodes).toEqual(copy);
  });

  it('centres coincident nodes on both axes', () => {
    const nodes = [person(1, 2), person(2, 1)].map((node) => ({ ...node, r: GRAPH_RADIUS_MIN, x: 42, y: -5 }));
    expect(scaleGraphNodes(nodes).every((node) => node.x === GRAPH_WIDTH / 2 && node.y === GRAPH_HEIGHT / 2)).toBe(true);
  });
});

describe('Analytics graph labels', () => {
  it('caps labels by code point and keeps full short labels', () => {
    expect(graphLabel('Theo')).toBe('Theo');
    expect(graphLabel('W'.repeat(GRAPH_LABEL_CHARACTERS))).toHaveLength(GRAPH_LABEL_CHARACTERS);
    expect(graphLabel('😀'.repeat(GRAPH_LABEL_CHARACTERS + 1))).toBe(`${'😀'.repeat(GRAPH_LABEL_CHARACTERS)}…`);
  });

  it('reserves one label height beyond the node radius regardless of name length', () => {
    const node = { name: 'W'.repeat(GRAPH_LABEL_CHARACTERS + 1), r: GRAPH_RADIUS_MAX };
    const short = { ...node, name: 'Theo' };
    expect(GRAPH_COLLISION_GAP).toBe(GRAPH_LABEL_SIZE);
    expect(graphCollisionRadius(node) - node.r).toBe(GRAPH_LABEL_SIZE);
    expect(graphCollisionRadius(short)).toBe(graphCollisionRadius(node));
  });
});
