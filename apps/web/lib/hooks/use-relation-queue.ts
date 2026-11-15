"use client";
// lib/hooks/use-relation-queue.ts
// SWR over GET /api/workspaces/[slug]/brain/relations?status=pending, plus a
// `judge` mutation that PATCHes one relation then revalidates the queue.
import { useCallback } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";
import type { MnemoRelation } from "@mnemo-ai/client-ts";
import type { RelationVerbLiteral } from "@/lib/mnemo/relation-verbs";

interface ListRelationsResponse {
  items: MnemoRelation[];
}

async function fetcher(url: string): Promise<ListRelationsResponse> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Relations fetch failed (${res.status})`);
  return res.json() as Promise<ListRelationsResponse>;
}

export interface JudgeArgs {
  relation: RelationVerbLiteral;
  confidence?: number;
  reason?: string;
}

export function useRelationQueue() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params?.workspaceSlug ?? "";
  const url = slug ? `/api/workspaces/${slug}/brain/relations?status=pending&limit=100` : null;

  const { data, error, isLoading, mutate } = useSWR<ListRelationsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });

  const judge = useCallback(
    async (id: string, args: JudgeArgs): Promise<MnemoRelation> => {
      if (!slug) throw new Error("no workspace");
      const res = await fetch(`/api/workspaces/${slug}/brain/relations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(`Judge failed (${res.status})`);
      const updated = (await res.json()) as MnemoRelation;
      // Drop the judged row from the pending queue optimistically, then revalidate.
      await mutate((prev) => (prev ? { items: prev.items.filter((r) => r.id !== id) } : prev), {
        revalidate: true,
      });
      return updated;
    },
    [slug, mutate]
  );

  return {
    relations: data?.items ?? [],
    isLoading,
    error: error instanceof Error ? error : null,
    judge,
    mutate,
  };
}
