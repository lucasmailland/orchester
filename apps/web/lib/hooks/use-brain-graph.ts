"use client";
// lib/hooks/use-brain-graph.ts
// SWR hook for GET /api/workspaces/[slug]/brain/graph.
// Transforms the API response into react-force-graph format.

import { useMemo } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";
// Client-safe subpath — pulls ONLY types/canvas, never the server DB query.
import type { GraphResponse, GraphNode, GraphEdge } from "@/lib/memory/graph-canvas";

export interface ForceGraphData {
  nodes: (GraphNode & { val: number })[];
  links: (GraphEdge & { source: string; target: string })[];
}

export interface UseBrainGraphResult {
  data: GraphResponse | null;
  graphData: ForceGraphData;
  maxMentionCount: number;
  isLoading: boolean;
  error: Error | null;
  mutate: () => void;
}

async function fetcher(url: string): Promise<GraphResponse> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Graph fetch failed (${res.status})`);
  return res.json() as Promise<GraphResponse>;
}

export interface UseBrainGraphInput {
  /** Centre on one entity. With depth=1 → 1-hop (base route); depth>1 → traverse route. */
  focus?: string | undefined;
  /** Hop radius for focus mode (1..3). Ignored when `focus` is absent. */
  depth?: number | undefined;
  /** ISO 8601 instant to reconstruct the graph as-of. */
  asOf?: string | undefined;
}

export function useBrainGraph(input: UseBrainGraphInput = {}): UseBrainGraphResult {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params?.workspaceSlug ?? "";
  const { focus, depth, asOf } = input;

  // depth>1 + a focus root → the multi-hop traverse endpoint; otherwise the
  // base graph endpoint (which still serves 1-hop focus and full-graph views).
  const useTraverse = Boolean(focus) && (depth ?? 1) > 1;
  const url = (() => {
    if (!slug) return null;
    const qs = new URLSearchParams();
    if (useTraverse) {
      qs.set("root", focus!);
      qs.set("depth", String(Math.min(3, Math.max(1, depth ?? 1))));
      if (asOf) qs.set("asOf", asOf);
      return `/api/workspaces/${slug}/brain/graph/traverse?${qs.toString()}`;
    }
    if (focus) qs.set("focus", focus);
    if (asOf) qs.set("asOf", asOf);
    const tail = qs.toString();
    return `/api/workspaces/${slug}/brain/graph${tail ? `?${tail}` : ""}`;
  })();

  const { data, error, isLoading, mutate } = useSWR<GraphResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  // Memoised on `data` identity. SWR returns a stable `data` reference between
  // renders unless the payload actually changes, so these derived structures
  // (new arrays each compute) only recompute on a real data change — keeping
  // downstream `useMemo`s in BrainGraph from invalidating every render.
  const maxMentionCount = useMemo(
    () => Math.max(1, ...(data?.nodes ?? []).map((n) => n.mentionCount)),
    [data]
  );

  const graphData = useMemo<ForceGraphData>(
    () => ({
      nodes: (data?.nodes ?? []).map((n) => ({ ...n, val: n.mentionCount })),
      links: (data?.edges ?? []).map((e) => ({ ...e })),
    }),
    [data]
  );

  return {
    data: data ?? null,
    graphData,
    maxMentionCount,
    isLoading,
    error: error instanceof Error ? error : null,
    mutate,
  };
}
