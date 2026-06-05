"use client";
// lib/hooks/use-graph-filters.ts
// Client-side filter state for the Memory Graph. Pure React state — no server calls.

import { useState, useMemo, useCallback } from "react";
// Client-safe subpath — types only here, but import from /graph so this module
// never transitively references the server DB query layer.
import type { GraphNode, GraphEdge } from "@orchester/mnemosyne/graph";

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
  toggleNodeKind: (kind: string) => void;
  toggleEdgeType: (type: string) => void;
  setMinMemoryStrength: (v: number) => void;
  setSearchQuery: (q: string) => void;
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
    const q = searchQuery.toLowerCase();
    return nodes.filter((n) => {
      const kind = n.entityKind ?? n.kind;
      if (!visibleNodeKinds.has(kind)) return false;
      if (n.avgMemoryStrength < minMemoryStrength) return false;
      if (q && !n.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [nodes, visibleNodeKinds, minMemoryStrength, searchQuery]);

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

  return {
    filteredNodes,
    filteredEdges,
    filteredNodeIds,
    filteredEdgeIds,
    visibleNodeKinds,
    visibleEdgeTypes,
    minMemoryStrength,
    searchQuery,
    toggleNodeKind,
    toggleEdgeType,
    setMinMemoryStrength,
    setSearchQuery,
  };
}
