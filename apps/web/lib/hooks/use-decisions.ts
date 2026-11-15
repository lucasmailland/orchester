"use client";
// lib/hooks/use-decisions.ts
// SWR over GET /api/workspaces/[slug]/brain/decisions + a `supersede` mutation,
// plus the supersedes chains derived from the flat list.
import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";
import type { MnemoDecision } from "@mnemo-ai/client-ts";
import { buildSupersedesChains, type SupersedesChain } from "@/lib/curation/supersedes-dag";

interface ListDecisionsResponse {
  items: MnemoDecision[];
}

async function fetcher(url: string): Promise<ListDecisionsResponse> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Decisions fetch failed (${res.status})`);
  return res.json() as Promise<ListDecisionsResponse>;
}

export function useDecisions() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params?.workspaceSlug ?? "";
  const url = slug ? `/api/workspaces/${slug}/brain/decisions?limit=200` : null;

  const { data, error, isLoading, mutate } = useSWR<ListDecisionsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  const decisions = data?.items ?? [];
  const chains: SupersedesChain[] = useMemo(() => buildSupersedesChains(decisions), [decisions]);

  const supersede = useCallback(
    async (id: string, supersededById: string): Promise<void> => {
      if (!slug) throw new Error("no workspace");
      const res = await fetch(
        `/api/workspaces/${slug}/brain/decisions/${encodeURIComponent(id)}/supersede`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ supersededById }),
        }
      );
      if (!res.ok) throw new Error(`Supersede failed (${res.status})`);
      await mutate();
    },
    [slug, mutate]
  );

  return {
    decisions,
    chains,
    isLoading,
    error: error instanceof Error ? error : null,
    supersede,
    mutate,
  };
}
