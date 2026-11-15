// apps/web/lib/memory/graph-canvas/path-edges.ts
//
// Pure, framework-free helpers for the "find path between two nodes" feature.
// Both renderers (ECharts + react-force-graph) need to answer "is this edge on
// the highlighted path?" identically, so the logic lives here and is unit-tested
// once instead of duplicated in two render loops.
//
// Edges are keyed UNDIRECTED: the graph's relations are directed (source/target)
// but a navigational path A→B should light the A—B edge regardless of which way
// the stored relation points. We canonicalise each unordered pair to
// `min|max` so `edgeKey("A","B") === edgeKey("B","A")`.

/** A node-end as a renderer might hand it to us: an id string, or a node object. */
export type EdgeEnd = string | { id: string } | null | undefined;

/** Resolve an edge end (string or `{ id }`) to its id, or "" if absent. */
export function endId(end: EdgeEnd): string {
  if (end == null) return "";
  return typeof end === "object" ? end.id : end;
}

/** Order-independent key for an undirected edge between two node ids. */
export function edgeKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Build the set of undirected edge keys that lie on a path.
 *
 * Accepts the SDK's `graphPath` result shape `{ path, edges }`. We derive keys
 * from BOTH sources and union them: `edges` is authoritative (it names the exact
 * relation rows traversed), while consecutive `path` pairs are a robust fallback
 * if `edges` is empty or omitted. An empty/one-node path yields an empty set.
 */
export function pathEdgeKeySet(input: {
  path?: string[] | null;
  edges?: Array<{ source: string; target: string }> | null;
}): Set<string> {
  const keys = new Set<string>();
  const path = input.path ?? [];
  for (let i = 0; i + 1 < path.length; i++) {
    keys.add(edgeKey(path[i]!, path[i + 1]!));
  }
  for (const e of input.edges ?? []) {
    if (e.source && e.target) keys.add(edgeKey(e.source, e.target));
  }
  return keys;
}

/** The set of node ids that sit on the path (for node-level emphasis). */
export function pathNodeIdSet(path?: string[] | null): Set<string> {
  return new Set((path ?? []).filter((id): id is string => Boolean(id)));
}

/**
 * Convenience: given an edge with arbitrary-shaped ends, return its undirected
 * key. Renderers call this per-edge against the `pathEdgeKeySet` to decide
 * whether to draw it as a path edge.
 */
export function keyForEdge(source: EdgeEnd, target: EdgeEnd): string {
  return edgeKey(endId(source), endId(target));
}
