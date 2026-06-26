// lib/memory/graph-analytics.ts
//
// Renderer-agnostic analytics layer for the memory graph. Given the same
// nodes + links the renderers consume, it derives two structural signals that
// make a large graph legible:
//
//   • community  — a Louvain partition (clusters of densely-connected nodes),
//                  used to colour the graph by "neighbourhood" instead of just
//                  entity type.
//   • centrality — PageRank importance, used to size nodes by how structurally
//                  central they are (a hub with many strong relations grows,
//                  a leaf stays small) and to pick which nodes survive the
//                  top-N cap on very large graphs.
//
// Both run on `graphology`, which is already a dependency. The function is
// pure and memoisable: feed it the filtered, visible graph and it returns a
// lookup keyed by node id plus a few summary stats. It is deliberately
// decoupled from any renderer so ECharts (and, later, the 3D view) can share it.

import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import pagerank from "graphology-metrics/centrality/pagerank";

export interface AnalyticsNode {
  id: string;
}

export interface AnalyticsLink {
  source: string;
  target: string;
  confidence?: number;
}

export interface NodeAnalytics {
  /** Louvain community index (stable within a single computation). */
  community: number;
  /** PageRank normalised to the most central node in the graph (0..1). */
  centrality: number;
  /** Raw PageRank score, kept for ranking / debugging. */
  centralityRaw: number;
}

export interface GraphAnalytics {
  byId: Map<string, NodeAnalytics>;
  /** Number of communities found by Louvain. */
  communityCount: number;
  /** Modularity of the partition (0..1; higher = cleaner clustering). */
  modularity: number;
  /** Node ids sorted by centrality, descending — drives the top-N cap. */
  ranked: string[];
}

// A calm, high-contrast palette for the dark canvas (#050507). Indices wrap,
// so an arbitrary number of communities still gets a colour; the last entry is
// a neutral slate that reads as "everything else".
export const COMMUNITY_COLORS = [
  "#7c83ff", // indigo
  "#5dcaa5", // teal
  "#e9a23b", // amber
  "#e2618c", // pink
  "#4cb5e6", // sky
  "#b48ef0", // violet
  "#7fd47f", // green
  "#f07b53", // coral
  "#d9d04a", // chartreuse
  "#56d0c4", // cyan
  "#c77dff", // purple
  "#9aa0b5", // slate
] as const;

export function communityColor(community: number): string {
  const i =
    ((community % COMMUNITY_COLORS.length) + COMMUNITY_COLORS.length) % COMMUNITY_COLORS.length;
  return COMMUNITY_COLORS[i] ?? "#9aa0b5";
}

const EMPTY: GraphAnalytics = {
  byId: new Map(),
  communityCount: 0,
  modularity: 0,
  ranked: [],
};

/**
 * Build a graphology graph from the visible nodes/links and compute community
 * + centrality for each node. Undirected and non-multi: for clustering and
 * importance we care about connectivity, not relation direction, and parallel
 * relations between the same pair accumulate as edge weight.
 */
export function computeGraphAnalytics(
  nodes: AnalyticsNode[],
  links: AnalyticsLink[]
): GraphAnalytics {
  if (nodes.length === 0) return EMPTY;

  const graph = new Graph({ type: "undirected", multi: false });

  for (const n of nodes) {
    if (!graph.hasNode(n.id)) graph.addNode(n.id);
  }

  for (const l of links) {
    if (l.source === l.target) continue; // skip self-loops
    if (!graph.hasNode(l.source) || !graph.hasNode(l.target)) continue;
    const w = l.confidence ?? 0.7;
    if (graph.hasEdge(l.source, l.target)) {
      // Parallel relation between the same pair → reinforce the tie.
      const cur = graph.getEdgeAttribute(l.source, l.target, "weight") as number;
      graph.setEdgeAttribute(l.source, l.target, "weight", cur + w);
    } else {
      graph.addEdge(l.source, l.target, { weight: w });
    }
  }

  const hasEdges = graph.size > 0;

  // Communities. Louvain needs edges to find structure; with none, every node
  // is its own singleton community (the disconnected-graph degenerate case).
  let communities: Record<string, number> = {};
  let communityCount: number;
  let modularity = 0;
  if (hasEdges) {
    const detailed = louvain.detailed(graph, { getEdgeWeight: "weight" });
    communities = detailed.communities;
    communityCount = detailed.count;
    modularity = detailed.modularity;
  } else {
    let i = 0;
    graph.forEachNode((id) => {
      communities[id] = i++;
    });
    communityCount = graph.order;
  }

  // Centrality. PageRank tolerates a fully disconnected graph (returns the
  // uniform distribution), so it is always safe to run.
  const scores = pagerank(graph, {
    getEdgeWeight: hasEdges ? "weight" : null,
  });
  let maxCentrality = 0;
  for (const id in scores) {
    const s = scores[id];
    if (s != null && s > maxCentrality) maxCentrality = s;
  }

  const byId = new Map<string, NodeAnalytics>();
  graph.forEachNode((id) => {
    const raw = scores[id] ?? 0;
    byId.set(id, {
      community: communities[id] ?? 0,
      centralityRaw: raw,
      centrality: maxCentrality > 0 ? raw / maxCentrality : 0,
    });
  });

  const ranked = graph.nodes().sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));

  return { byId, communityCount, modularity, ranked };
}
