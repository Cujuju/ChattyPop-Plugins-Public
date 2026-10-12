import { describe, expect, it } from 'vitest';
import type { ConversationPerson } from '../shared/conversations';
import { graphInputs, GRAPH_PEOPLE_MAX, GRAPH_RADIUS_MIN, GRAPH_RADIUS_MAX, GRAPH_SIZE } from '../renderer/graphInputs';
import { graphLayout, GRAPH_MARGIN } from '../renderer/graphLayout';

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

  it('produces finite bounded positions deterministically without mutating core results', () => {
    const people = [person(1, 3), person(2, 2), person(3, 1)];
    const stats = { people, pairs: [{ first: people[0]!, second: people[1]!, exchanges: 2 }, { first: people[0]!, second: people[2]!, exchanges: 1 }] };
    const copy = structuredClone(stats);
    const first = graphLayout(stats);
    expect(graphLayout(stats)).toEqual(first);
    expect(first.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y) && node.x >= GRAPH_MARGIN && node.x <= GRAPH_SIZE - GRAPH_MARGIN && node.y >= GRAPH_MARGIN && node.y <= GRAPH_SIZE - GRAPH_MARGIN)).toBe(true);
    expect(stats).toEqual(copy);
  });
});
