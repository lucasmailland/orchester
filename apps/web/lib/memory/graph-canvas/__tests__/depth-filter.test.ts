// apps/web/lib/memory/graph-canvas/__tests__/depth-filter.test.ts
import { describe, it, expect } from "vitest";
import { filterGraphToIds } from "../depth-filter";
import type { GraphResponse, GraphNode, GraphEdge } from "../types";

function node(id: string, kind: GraphNode["kind"]): GraphNode {
  return {
    id,
    kind,
    label: id,
    mentionCount: 0,
    factCount: 0,
    avgMemoryStrength: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
function edge(id: string, source: string, target: string): GraphEdge {
  return { id, source, target, relation: "related", confidence: 0.7, provenance: null };
}

const graph: GraphResponse = {
  nodes: [node("A", "entity"), node("B", "entity"), node("C", "episode"), node("D", "decision")],
  edges: [edge("e1", "A", "B"), edge("e2", "B", "C"), edge("e3", "C", "D")],
  meta: { entityCount: 2, episodeCount: 1, decisionCount: 1, relationCount: 3 },
};

describe("filterGraphToIds", () => {
  it("keeps only the requested nodes", () => {
    const out = filterGraphToIds(graph, new Set(["A", "B"]));
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
  });
  it("drops edges with a missing endpoint", () => {
    const out = filterGraphToIds(graph, new Set(["A", "B"]));
    expect(out.edges.map((e) => e.id)).toEqual(["e1"]); // e2 dropped (C absent)
  });
  it("recomputes meta from survivors", () => {
    const out = filterGraphToIds(graph, new Set(["A", "B", "C"]));
    expect(out.meta).toEqual({
      entityCount: 2,
      episodeCount: 1,
      decisionCount: 0,
      relationCount: 2, // e1 (A-B) + e2 (B-C)
    });
  });
  it("returns an empty graph for an empty keep set", () => {
    const out = filterGraphToIds(graph, new Set());
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
    expect(out.meta).toEqual({
      entityCount: 0,
      episodeCount: 0,
      decisionCount: 0,
      relationCount: 0,
    });
  });
});
