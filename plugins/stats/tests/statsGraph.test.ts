import { describe, expect, it } from 'vitest';
import type { ConversationPerson } from '../shared/conversations';
import { graphInputs, GRAPH_PEOPLE_MAX, GRAPH_RADIUS_MIN, GRAPH_RADIUS_MAX } from '../renderer/graphInputs';
import { graphLayout } from '../renderer/graphLayout';
import { GRAPH_LABEL_CHARACTERS, GRAPH_LABEL_COLLISION_PADDING, GRAPH_LABEL_GAP, GRAPH_LABEL_SIZE, graphCollisionRadius, graphLabel } from '../renderer/graphLabels';

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

  it('keeps representative labels separated without shrinking collision distances afterward', () => {
    const people = [person(1, 3), person(2, 2), person(3, 1)];
    people[0]!.name = 'LongNickname';
    people[1]!.name = 'Theo';
    people[2]!.name = 'W'.repeat(GRAPH_LABEL_CHARACTERS + 4);
    const graph = graphLayout({ people, pairs: [{ first: people[0]!, second: people[1]!, exchanges: 2 }, { first: people[0]!, second: people[2]!, exchanges: 1 }] });
    for (let first = 0; first < graph.nodes.length; first++) {
      for (let second = first + 1; second < graph.nodes.length; second++) {
        const a = graph.nodes[first]!;
        const b = graph.nodes[second]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(graphCollisionRadius(a) + graphCollisionRadius(b) - 1);
      }
    }
  });
});

describe('Analytics graph labels', () => {
  it('caps labels by code point and keeps full short labels', () => {
    expect(graphLabel('Theo')).toBe('Theo');
    expect(graphLabel('W'.repeat(GRAPH_LABEL_CHARACTERS))).toHaveLength(GRAPH_LABEL_CHARACTERS);
    expect(graphLabel('😀'.repeat(GRAPH_LABEL_CHARACTERS + 1))).toBe(`${'😀'.repeat(GRAPH_LABEL_CHARACTERS)}…`);
  });

  it('reserves a capped label including its ellipsis and reduces the envelope for short names', () => {
    const node = { name: 'W'.repeat(GRAPH_LABEL_CHARACTERS + 1), r: GRAPH_RADIUS_MAX };
    expect(graphCollisionRadius(node)).toBe(Math.hypot(node.r + GRAPH_LABEL_GAP + GRAPH_LABEL_COLLISION_PADDING, GRAPH_LABEL_SIZE));
    expect(graphCollisionRadius({ ...node, name: 'Theo' })).toBeLessThan(graphCollisionRadius(node));
    expect(graphCollisionRadius({ ...node, name: 'W'.repeat(GRAPH_LABEL_CHARACTERS * 2) })).toBe(graphCollisionRadius(node));
  });
});
