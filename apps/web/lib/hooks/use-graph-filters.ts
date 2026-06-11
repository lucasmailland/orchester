"use client";
// lib/hooks/use-graph-filters.ts
// Client-side filter state for the Memory Graph. Pure React state — no server calls.

import { useState, useMemo, useCallback } from "react";
// Client-safe subpath — types only here, but import from /graph so this module
// never transitively references the server DB query layer.
import type { GraphNode, GraphEdge } from "@/lib/memory/graph-canvas";

export const ALL_NODE_KINDS = [
  "person",
  "organization",
  "project",
  "concept",
  "place",
  "other",
  "episode",
  "decision",
] as const;

export const ALL_EDGE_TYPES = [
  "related",
  "compatible",
  "not_conflict",
  "conflicts_with",
  "derived_from",
  "scoped",
  "supersedes",
  "part_of",
  "member_of",
] as const;

export interface GraphFiltersState {
  filteredNodes: GraphNode[];
  filteredEdges: GraphEdge[];
  filteredNodeIds: Set<string>;
  filteredEdgeIds: Set<string>;
  visibleNodeKinds: Set<string>;
  visibleEdgeTypes: Set<string>;
  minMemoryStrength: number;
  searchQuery: string;
  /** Nodes matching the search query. Empty set = no active search.
   *  Search HIGHLIGHTS rather than filters — hiding non-matches destroys
   *  the context that makes a match meaningful. */
  searchMatchIds: Set<string>;
  /** Per-kind / per-relation totals over the RAW data — shown on the filter
   *  chips so the operator knows what a toggle will add or remove. */
  nodeKindCounts: Record<string, number>;
  edgeTypeCounts: Record<string, number>;
  totalNodeCount: number;
  /** True when every filter is at its default — the reset button hides. */
  isPristine: boolean;
  toggleNodeKind: (kind: string) => void;
  toggleEdgeType: (type: string) => void;
  setAllNodeKinds: (visible: boolean) => void;
  setAllEdgeTypes: (visible: boolean) => void;
  setMinMemoryStrength: (v: number) => void;
  setSearchQuery: (q: string) => void;
  resetAll: () => void;
}

export function useGraphFilters(nodes: GraphNode[], edges: GraphEdge[]): GraphFiltersState {
  const [visibleNodeKinds, setVisibleNodeKinds] = useState<Set<string>>(
    () => new Set<string>(ALL_NODE_KINDS)
  );
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<string>>(
    () => new Set<string>(ALL_EDGE_TYPES)
  );
  const [minMemoryStrength, setMinMemoryStrength] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      const kind = n.entityKind ?? n.kind;
      if (!visibleNodeKinds.has(kind)) return false;
      if (n.avgMemoryStrength < minMemoryStrength) return false;
      return true;
    });
  }, [nodes, visibleNodeKinds, minMemoryStrength]);

  const searchMatchIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return new Set<string>();
    return new Set(filteredNodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
  }, [filteredNodes, searchQuery]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(
    () =>
      edges.filter(
        (e) =>
          visibleEdgeTypes.has(e.relation) &&
          filteredNodeIds.has(e.source) &&
          filteredNodeIds.has(e.target)
      ),
    [edges, visibleEdgeTypes, filteredNodeIds]
  );

  // Memoised on `filteredEdges` so the Set identity is stable between renders —
  // BrainGraph's `filteredGraphData` useMemo depends on it and would otherwise
  // recompute every render against a fresh Set.
  const filteredEdgeIds = useMemo(() => new Set(filteredEdges.map((e) => e.id)), [filteredEdges]);

  const nodeKindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of nodes) {
      const kind = n.entityKind ?? n.kind;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    return counts;
  }, [nodes]);

  const edgeTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of edges) counts[e.relation] = (counts[e.relation] ?? 0) + 1;
    return counts;
  }, [edges]);

  const toggleNodeKind = useCallback(
    (kind: string) =>
      setVisibleNodeKinds((prev) => {
        const next = new Set(prev);
        if (next.has(kind)) next.delete(kind);
        else next.add(kind);
        return next;
      }),
    []
  );

  const toggleEdgeType = useCallback(
    (type: string) =>
      setVisibleEdgeTypes((prev) => {
        const next = new Set(prev);
        if (next.has(type)) next.delete(type);
        else next.add(type);
        return next;
      }),
    []
  );

  const setAllNodeKinds = useCallback(
    (visible: boolean) =>
      setVisibleNodeKinds(visible ? new Set<string>(ALL_NODE_KINDS) : new Set<string>()),
    []
  );

  const setAllEdgeTypes = useCallback(
    (visible: boolean) =>
      setVisibleEdgeTypes(visible ? new Set<string>(ALL_EDGE_TYPES) : new Set<string>()),
    []
  );

  const resetAll = useCallback(() => {
    setVisibleNodeKinds(new Set<string>(ALL_NODE_KINDS));
    setVisibleEdgeTypes(new Set<string>(ALL_EDGE_TYPES));
    setMinMemoryStrength(0);
    setSearchQuery("");
  }, []);

  const isPristine =
    visibleNodeKinds.size === ALL_NODE_KINDS.length &&
    visibleEdgeTypes.size === ALL_EDGE_TYPES.length &&
    minMemoryStrength === 0 &&
    searchQuery.trim() === "";

  return {
    filteredNodes,
    filteredEdges,
    filteredNodeIds,
    filteredEdgeIds,
    visibleNodeKinds,
    visibleEdgeTypes,
    minMemoryStrength,
    searchQuery,
    searchMatchIds,
    nodeKindCounts,
    edgeTypeCounts,
    totalNodeCount: nodes.length,
    isPristine,
    toggleNodeKind,
    toggleEdgeType,
    setAllNodeKinds,
    setAllEdgeTypes,
    setMinMemoryStrength,
    setSearchQuery,
    resetAll,
  };
}
