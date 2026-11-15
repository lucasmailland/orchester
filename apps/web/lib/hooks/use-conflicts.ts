"use client";
// lib/hooks/use-conflicts.ts
// SWR over GET /api/workspaces/[slug]/brain/conflicts + a `resolve` mutation.
// Also exposes `conflictEdgeIds` so BrainGraph can highlight conflicts_with
// edges that match an open conflict pair.
import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";
import type {
  ConflictPair,
  ResolveConflictInput,
  ResolveConflictResponse,
} from "@mnemo-ai/client-ts";
import { conflictRelationIds } from "@/lib/curation/group-conflicts";

interface ListConflictsResponse {
  pairs: ConflictPair[];
}

async function fetcher(url: string): Promise<ListConflictsResponse> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Conflicts fetch failed (${res.status})`);
  return res.json() as Promise<ListConflictsResponse>;
}

export function useConflicts() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params?.workspaceSlug ?? "";
  const url = slug ? `/api/workspaces/${slug}/brain/conflicts?limit=20` : null;

  const { data, error, isLoading, mutate } = useSWR<ListConflictsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });

  const pairs = data?.pairs ?? [];

  /** relationIds of open conflicts — these are the `conflicts_with` edge ids
   *  the graph should light up. */
  const conflictEdgeIds = useMemo(() => conflictRelationIds(pairs), [pairs]);

  const resolve = useCallback(
    async (relationId: string, input: ResolveConflictInput): Promise<ResolveConflictResponse> => {
      if (!slug) throw new Error("no workspace");
      const res = await fetch(
        `/api/workspaces/${slug}/brain/conflicts/${encodeURIComponent(relationId)}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (!res.ok) throw new Error(`Resolve failed (${res.status})`);
      const out = (await res.json()) as ResolveConflictResponse;
      await mutate(
        (prev) => (prev ? { pairs: prev.pairs.filter((p) => p.relationId !== relationId) } : prev),
        { revalidate: true }
      );
      return out;
    },
    [slug, mutate]
  );

  return {
    pairs,
    conflictEdgeIds,
    isLoading,
    error: error instanceof Error ? error : null,
    resolve,
    mutate,
  };
}
