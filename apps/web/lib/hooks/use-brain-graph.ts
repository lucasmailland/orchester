"use client";
// lib/hooks/use-brain-graph.ts
// SWR hook for GET /api/workspaces/[slug]/brain/graph.
// Transforms the API response into react-force-graph format.

import { useMemo } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";
// Client-safe subpath — pulls ONLY types/canvas, never the server DB query.
import type { GraphResponse, GraphNode, GraphEdge } from "@mnemosyne/core/graph";

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

export function useBrainGraph(focusEntityId?: string): UseBrainGraphResult {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params?.workspaceSlug ?? "";

  const url = slug
    ? `/api/workspaces/${slug}/brain/graph${focusEntityId ? `?focus=${encodeURIComponent(focusEntityId)}` : ""}`
    : null;

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
