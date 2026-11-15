// apps/web/lib/memory/graph-canvas/depth-filter.ts
//
// Pure helper for multi-hop focus. `graphTraverse` returns the node ids within
// N hops of a root; the route holds the full workspace GraphResponse and must
// project it down to that neighbourhood. Kept framework-free + unit-tested so
// the route stays a thin HTTP adapter.

import type { GraphResponse } from "./types";

/**
 * Restrict a GraphResponse to a set of node ids, dropping edges whose endpoints
 * are not BOTH present. `meta` is recomputed from the surviving nodes/edges so
 * the status bar counts match what is rendered.
 *
 * The `keepIds` set should already include the focus root (the caller adds it —
 * `graphTraverse` returns neighbours, excluding the root itself).
 */
export function filterGraphToIds(graph: GraphResponse, keepIds: Set<string>): GraphResponse {
  const nodes = graph.nodes.filter((n) => keepIds.has(n.id));
  const edges = graph.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target));
  let entityCount = 0;
  let episodeCount = 0;
  let decisionCount = 0;
  for (const n of nodes) {
    if (n.kind === "entity") entityCount++;
    else if (n.kind === "episode") episodeCount++;
    else if (n.kind === "decision") decisionCount++;
  }
  return {
    nodes,
    edges,
    meta: { entityCount, episodeCount, decisionCount, relationCount: edges.length },
  };
}
