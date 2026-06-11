"use client";
// lib/hooks/use-entity-facts.ts
// SWR hook for GET /api/mnemo/entities/[id]/facts — the actual memory
// content (fact statements) linked to a graph entity. Powers the
// "Memories" section of the graph's node-detail panel.

import useSWR from "swr";

/** Client-side projection of the fact wire shape — only what the
 *  detail panel renders. The full CoreMemoryFact has ~25 fields. */
export interface EntityFact {
  id: string;
  kind: string;
  subject: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  updatedAt: string;
}

interface EntityFactsResponse {
  facts: EntityFact[];
}

async function fetcher(url: string): Promise<EntityFactsResponse> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Entity facts fetch failed (${res.status})`);
  return res.json() as Promise<EntityFactsResponse>;
}

/** Pass null to pause (e.g. episode/decision nodes have no entity facts). */
export function useEntityFacts(entityId: string | null) {
  const url = entityId
    ? `/api/mnemo/entities/${encodeURIComponent(entityId)}/facts?limit=25`
    : null;
  const { data, error, isLoading } = useSWR<EntityFactsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });
  return { facts: data?.facts ?? [], isLoading, error: error ?? null };
}
