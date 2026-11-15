"use client";
// lib/hooks/use-graph-path.ts
// SWR hook for GET /api/workspaces/[slug]/brain/graph/path. Fires only when
// BOTH endpoints are present; returns the path node ids + traversed edges.

import useSWR from "swr";
import { useParams } from "next/navigation";

export interface GraphPathResult {
  path: string[];
  edges: Array<{ source: string; target: string; relation: string }>;
}

async function fetcher(url: string): Promise<GraphPathResult> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Path fetch failed (${res.status})`);
  return res.json() as Promise<GraphPathResult>;
}

export interface UseGraphPathResult {
  path: GraphPathResult | null;
  isLoading: boolean;
  error: Error | null;
}

export function useGraphPath(
  from: string | null,
  to: string | null,
  asOf: string | null
): UseGraphPathResult {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params?.workspaceSlug ?? "";

  const url =
    slug && from && to && from !== to
      ? (() => {
          const qs = new URLSearchParams({ from, to });
          if (asOf) qs.set("asOf", asOf);
          return `/api/workspaces/${slug}/brain/graph/path?${qs.toString()}`;
        })()
      : null;

  const { data, error, isLoading } = useSWR<GraphPathResult>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  return {
    path: data ?? null,
    isLoading,
    error: error instanceof Error ? error : null,
  };
}
