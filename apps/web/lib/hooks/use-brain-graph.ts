"use client";
// lib/hooks/use-brain-graph.ts
// SWR hook for GET /api/workspaces/[slug]/brain/graph.
// Transforms the API response into react-force-graph format.

import useSWR from "swr";
import { useParams } from "next/navigation";
import type { GraphResponse, GraphNode, GraphEdge } from "@orchester/mnemosyne";

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

  const maxMentionCount = Math.max(1, ...(data?.nodes ?? []).map((n) => n.mentionCount));

  const graphData: ForceGraphData = {
    nodes: (data?.nodes ?? []).map((n) => ({ ...n, val: n.mentionCount })),
    links: (data?.edges ?? []).map((e) => ({ ...e })),
  };

  return {
    data: data ?? null,
    graphData,
    maxMentionCount,
    isLoading,
    error: error instanceof Error ? error : null,
    mutate,
  };
}
